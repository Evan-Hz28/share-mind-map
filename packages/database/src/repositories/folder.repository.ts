import { sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { newId } from "../id.js";
import { permanentlyDeleteDocuments } from "./document.repository.js";
import type { DatabaseTransaction } from "./member.repository.js";
import { Phase2RepositoryError } from "./phase2.types.js";

export interface FolderRecord {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  nameNormalized: string;
  sortKey: number;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface FolderRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  name_normalized: string;
  sort_key: number;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

/** 文件夹层级上限,根文件夹算第 1 层。 */
export const MAX_FOLDER_DEPTH = 8;
/** 单工作空间文件夹总数上限,包含所有层级。 */
export const MAX_FOLDERS_PER_WORKSPACE = 500;

/** 递归 CTE 的保险丝,正常数据不可能触到。 */
const MAX_TREE_DEPTH = 64;

const folderColumns = sql`id, workspace_id, parent_id, name, name_normalized, sort_key,
  created_by, updated_by, created_at, updated_at`;

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toFolderRecord(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    name: row.name,
    nameNormalized: row.name_normalized,
    sortKey: row.sort_key,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

async function lockWorkspace(transaction: DatabaseTransaction, workspaceId: string): Promise<void> {
  const result = await transaction.execute<{ id: string }>(
    sql`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`,
  );
  if (result.rows[0] === undefined) {
    throw new Phase2RepositoryError("WORKSPACE_NOT_FOUND", "Workspace does not exist.");
  }
}

/**
 * 文件夹在树里的层级,根为 1。找不到返回 null。
 * 递归链有深度保险,数据意外成环也不会挂死。
 */
async function folderLevel(
  transaction: DatabaseTransaction,
  workspaceId: string,
  folderId: string,
): Promise<number | null> {
  const result = await transaction.execute<{ level: number }>(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, 1 AS level
      FROM folders
      WHERE id = ${folderId} AND workspace_id = ${workspaceId} AND trashed_at IS NULL
      UNION ALL
      SELECT folder.id, folder.parent_id, chain.level + 1
      FROM folders AS folder
      JOIN chain ON folder.id = chain.parent_id
      WHERE folder.workspace_id = ${workspaceId}
        AND folder.trashed_at IS NULL
        AND chain.level < ${MAX_TREE_DEPTH}
    )
    SELECT max(level)::int AS level FROM chain
  `);
  const level = result.rows[0]?.level;
  return typeof level === "number" ? level : null;
}

/** 以 folderId 为根的整棵子树(含自己)。 */
async function subtreeFolderIds(
  transaction: DatabaseTransaction,
  workspaceId: string,
  folderId: string,
): Promise<string[]> {
  const result = await transaction.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id, 0 AS depth
      FROM folders
      WHERE id = ${folderId} AND workspace_id = ${workspaceId} AND trashed_at IS NULL
      UNION ALL
      SELECT folder.id, subtree.depth + 1
      FROM folders AS folder
      JOIN subtree ON folder.parent_id = subtree.id
      WHERE folder.workspace_id = ${workspaceId}
        AND folder.trashed_at IS NULL
        AND subtree.depth < ${MAX_TREE_DEPTH}
    )
    SELECT id FROM subtree
  `);
  return result.rows.map((row) => row.id);
}

export class FolderRepository {
  public async create(
    transaction: DatabaseTransaction,
    input: {
      workspaceId: string;
      parentId?: string | null;
      name: string;
      nameNormalized: string;
      actorUserId: string;
    },
  ): Promise<FolderRecord> {
    await lockWorkspace(transaction, input.workspaceId);
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      const level = await folderLevel(transaction, input.workspaceId, parentId);
      if (level === null) {
        throw new Phase2RepositoryError("FOLDER_NOT_FOUND", "Parent folder does not exist.");
      }
      if (level >= MAX_FOLDER_DEPTH) {
        throw new Phase2RepositoryError(
          "FOLDER_DEPTH_EXCEEDED",
          "Folder nesting depth limit reached.",
        );
      }
    }
    const count = await transaction.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM folders
      WHERE workspace_id = ${input.workspaceId} AND trashed_at IS NULL
    `);
    if ((count.rows[0]?.count ?? 0) >= MAX_FOLDERS_PER_WORKSPACE) {
      throw new Phase2RepositoryError("FOLDER_LIMIT_REACHED", "Workspace folder limit reached.");
    }
    const id = newId();
    const result = await transaction.execute<FolderRow>(sql`
      INSERT INTO folders (id, workspace_id, parent_id, name, name_normalized, sort_key,
                           created_by, updated_by)
      VALUES (${id}, ${input.workspaceId}, ${parentId}, ${input.name}, ${input.nameNormalized},
              (SELECT COALESCE(MAX(sort_key), -1) + 1 FROM folders
               WHERE workspace_id = ${input.workspaceId}
                 AND parent_id IS NOT DISTINCT FROM ${parentId}
                 AND trashed_at IS NULL),
              ${input.actorUserId}, ${input.actorUserId})
      RETURNING ${folderColumns}
    `);
    const row = result.rows[0];
    if (row === undefined) throw new Error("Folder insert returned no row.");
    return toFolderRecord(row);
  }

  public async list(database: Database, workspaceId: string): Promise<FolderRecord[]> {
    const result = await database.$client.query<FolderRow>(
      `
      SELECT id, workspace_id, parent_id, name, name_normalized, sort_key,
             created_by, updated_by, created_at, updated_at
      FROM folders
      WHERE workspace_id = $1 AND trashed_at IS NULL
      ORDER BY sort_key ASC, name_normalized ASC, id ASC
    `,
      [workspaceId],
    );
    return result.rows.map(toFolderRecord);
  }

  public async rename(
    transaction: DatabaseTransaction,
    input: {
      workspaceId: string;
      folderId: string;
      name: string;
      nameNormalized: string;
      actorUserId: string;
    },
  ): Promise<FolderRecord> {
    await lockWorkspace(transaction, input.workspaceId);
    const result = await transaction.execute<FolderRow>(sql`
      UPDATE folders
      SET name = ${input.name}, name_normalized = ${input.nameNormalized},
          updated_by = ${input.actorUserId}, updated_at = now()
      WHERE id = ${input.folderId} AND workspace_id = ${input.workspaceId} AND trashed_at IS NULL
      RETURNING ${folderColumns}
    `);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Phase2RepositoryError("FOLDER_NOT_FOUND", "Folder does not exist.");
    }
    return toFolderRecord(row);
  }

  /**
   * 全量写入同一父文件夹下的显示顺序。folderIds 必须与当前兄弟集合完全一致,
   * 否则说明有人在你拖拽期间增删了文件夹或改了层级,要求前端重新拉取。
   */
  public async reorder(
    transaction: DatabaseTransaction,
    input: {
      workspaceId: string;
      parentId: string | null;
      folderIds: readonly string[];
      actorUserId: string;
    },
  ): Promise<number> {
    await lockWorkspace(transaction, input.workspaceId);
    const parentId = input.parentId ?? null;
    const siblings = await transaction.execute<{ id: string }>(sql`
      SELECT id
      FROM folders
      WHERE workspace_id = ${input.workspaceId}
        AND parent_id IS NOT DISTINCT FROM ${parentId}
        AND trashed_at IS NULL
      FOR UPDATE
    `);
    const siblingIds = new Set(siblings.rows.map((row) => row.id));
    const requestedIds = new Set(input.folderIds);
    if (
      input.folderIds.length === 0 ||
      requestedIds.size !== input.folderIds.length ||
      requestedIds.size !== siblingIds.size ||
      [...requestedIds].some((id) => !siblingIds.has(id))
    ) {
      throw new Phase2RepositoryError(
        "FOLDER_ORDER_CONFLICT",
        "Folder order does not match the current folder list.",
      );
    }

    const folderIds = sql.param([...input.folderIds]);
    await transaction.execute(sql`
      UPDATE folders AS folder
      SET sort_key = ordered.ord - 1,
          updated_by = ${input.actorUserId},
          updated_at = now()
      FROM unnest(${folderIds}::uuid[]) WITH ORDINALITY AS ordered(id, ord)
      WHERE folder.id = ordered.id
        AND folder.workspace_id = ${input.workspaceId}
        AND folder.trashed_at IS NULL
    `);
    return input.folderIds.length;
  }

  /**
   * 改组文件夹的父节点。目标不能是自己或自己的后代;整棵子树都要塞得进层级上限。
   */
  public async move(
    transaction: DatabaseTransaction,
    input: {
      workspaceId: string;
      folderId: string;
      parentId: string | null;
      actorUserId: string;
    },
  ): Promise<FolderRecord> {
    await lockWorkspace(transaction, input.workspaceId);
    const folder = await transaction.execute<FolderRow>(sql`
      SELECT ${folderColumns}
      FROM folders
      WHERE id = ${input.folderId} AND workspace_id = ${input.workspaceId} AND trashed_at IS NULL
      FOR UPDATE
    `);
    const row = folder.rows[0];
    if (row === undefined) {
      throw new Phase2RepositoryError("FOLDER_NOT_FOUND", "Folder does not exist.");
    }
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      if (parentId === input.folderId) {
        throw new Phase2RepositoryError("FOLDER_MOVE_CYCLE", "Cannot move a folder into itself.");
      }
      const subtree = new Set(
        await subtreeFolderIds(transaction, input.workspaceId, input.folderId),
      );
      if (subtree.has(parentId)) {
        throw new Phase2RepositoryError(
          "FOLDER_MOVE_CYCLE",
          "Cannot move a folder into its own descendant.",
        );
      }
      const targetLevel = await folderLevel(transaction, input.workspaceId, parentId);
      if (targetLevel === null) {
        throw new Phase2RepositoryError("FOLDER_NOT_FOUND", "Parent folder does not exist.");
      }
      const height = await transaction.execute<{ height: number }>(sql`
        WITH RECURSIVE subtree AS (
          SELECT id, 0 AS depth
          FROM folders
          WHERE id = ${input.folderId} AND workspace_id = ${input.workspaceId}
          UNION ALL
          SELECT child.id, subtree.depth + 1
          FROM folders AS child
          JOIN subtree ON child.parent_id = subtree.id
          WHERE child.workspace_id = ${input.workspaceId}
            AND child.trashed_at IS NULL
            AND subtree.depth < ${MAX_TREE_DEPTH}
        )
        SELECT COALESCE(max(depth), 0)::int AS height FROM subtree
      `);
      if (targetLevel + 1 + (height.rows[0]?.height ?? 0) > MAX_FOLDER_DEPTH) {
        throw new Phase2RepositoryError(
          "FOLDER_DEPTH_EXCEEDED",
          "Folder nesting depth limit reached.",
        );
      }
    }

    const result = await transaction.execute<FolderRow>(sql`
      UPDATE folders
      SET parent_id = ${parentId},
          sort_key = (SELECT COALESCE(MAX(sort_key), -1) + 1 FROM folders
                      WHERE workspace_id = ${input.workspaceId}
                        AND parent_id IS NOT DISTINCT FROM ${parentId}
                        AND trashed_at IS NULL
                        AND id <> ${input.folderId}),
          updated_by = ${input.actorUserId},
          updated_at = now()
      WHERE id = ${input.folderId} AND workspace_id = ${input.workspaceId} AND trashed_at IS NULL
      RETURNING ${folderColumns}
    `);
    const moved = result.rows[0];
    if (moved === undefined) {
      throw new Phase2RepositoryError("FOLDER_NOT_FOUND", "Folder does not exist.");
    }
    return toFolderRecord(moved);
  }

  public async checkDelete(
    transaction: DatabaseTransaction,
    workspaceId: string,
    folderId: string,
  ): Promise<{
    folder: FolderRecord;
    documentCount: number;
    descendantFolderCount: number;
    canDelete: boolean;
  }> {
    await lockWorkspace(transaction, workspaceId);
    const folder = await transaction.execute<FolderRow>(sql`
      SELECT ${folderColumns}
      FROM folders
      WHERE id = ${folderId} AND workspace_id = ${workspaceId} AND trashed_at IS NULL
      FOR UPDATE
    `);
    const row = folder.rows[0];
    if (row === undefined)
      throw new Phase2RepositoryError("FOLDER_NOT_FOUND", "Folder does not exist.");
    const folderIds = await subtreeFolderIds(transaction, workspaceId, folderId);
    const ids = sql.param(folderIds);
    const count = await transaction.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM documents
      WHERE folder_id = ANY(${ids}::uuid[]) AND workspace_id = ${workspaceId}
    `);
    const documentCount = count.rows[0]?.count ?? 0;
    return {
      folder: toFolderRecord(row),
      documentCount,
      descendantFolderCount: folderIds.length - 1,
      canDelete: documentCount === 0,
    };
  }

  /**
   * 永久删除文件夹及其整棵子树里的文档。文件夹行本身也硬删:
   * 导入任务保留,只把子树的 target_folder_id 置空,避免外键阻塞且不残留垃圾行。
   */
  public async deleteWithDocuments(
    transaction: DatabaseTransaction,
    input: {
      workspaceId: string;
      folderId: string;
      expectedDocumentCount?: number;
    },
  ): Promise<{
    folder: FolderRecord;
    folderIds: string[];
    documentIds: string[];
    documentCount: number;
    objectKeys: string[];
  }> {
    await lockWorkspace(transaction, input.workspaceId);
    const folder = await transaction.execute<FolderRow>(sql`
      SELECT ${folderColumns}
      FROM folders
      WHERE id = ${input.folderId} AND workspace_id = ${input.workspaceId} AND trashed_at IS NULL
      FOR UPDATE
    `);
    const folderRow = folder.rows[0];
    if (folderRow === undefined) {
      throw new Phase2RepositoryError("FOLDER_NOT_FOUND", "Folder does not exist.");
    }

    const folderIds = await subtreeFolderIds(transaction, input.workspaceId, input.folderId);
    const subtreeIds = sql.param(folderIds);

    const activeImports = await transaction.execute<{ id: string }>(sql`
      SELECT id
      FROM import_jobs
      WHERE workspace_id = ${input.workspaceId}
        AND target_folder_id = ANY(${subtreeIds}::uuid[])
        AND phase IN ('waiting', 'uploading', 'parsing', 'persisting')
      LIMIT 1
    `);
    if (activeImports.rows[0] !== undefined) {
      throw new Phase2RepositoryError("FOLDER_DELETE_BLOCKED", "Folder has active import jobs.");
    }

    const documents = await transaction.execute<{ id: string }>(sql`
      SELECT id
      FROM documents
      WHERE folder_id = ANY(${subtreeIds}::uuid[]) AND workspace_id = ${input.workspaceId}
    `);
    const documentIds = documents.rows.map((document) => document.id);
    if (
      input.expectedDocumentCount !== undefined &&
      input.expectedDocumentCount !== documentIds.length
    ) {
      throw new Phase2RepositoryError(
        "FOLDER_DELETE_CONFLICT",
        "Folder contents changed since the delete check.",
      );
    }

    const deletion = await permanentlyDeleteDocuments(transaction, {
      workspaceId: input.workspaceId,
      documentIds,
      includeTrashed: true,
    });

    await transaction.execute(sql`
      UPDATE import_jobs
      SET target_folder_id = NULL, updated_at = now()
      WHERE workspace_id = ${input.workspaceId}
        AND target_folder_id = ANY(${subtreeIds}::uuid[])
    `);
    // 子文件夹靠 folders_parent_fk 的 ON DELETE CASCADE 一起删。
    await transaction.execute(sql`
      DELETE FROM folders
      WHERE id = ${input.folderId} AND workspace_id = ${input.workspaceId}
    `);

    return {
      folder: toFolderRecord(folderRow),
      folderIds,
      documentIds,
      documentCount: documentIds.length,
      objectKeys: deletion.objectKeys,
    };
  }
}
