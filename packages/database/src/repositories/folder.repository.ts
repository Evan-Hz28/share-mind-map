import { sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { newId } from "../id.js";
import type { DatabaseTransaction } from "./member.repository.js";
import { Phase2RepositoryError } from "./phase2.types.js";

export interface FolderRecord {
  id: string;
  workspaceId: string;
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
  name: string;
  name_normalized: string;
  sort_key: number;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toFolderRecord(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
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

export class FolderRepository {
  public async create(
    transaction: DatabaseTransaction,
    input: {
      workspaceId: string;
      name: string;
      nameNormalized: string;
      actorUserId: string;
    },
  ): Promise<FolderRecord> {
    await lockWorkspace(transaction, input.workspaceId);
    const count = await transaction.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM folders
      WHERE workspace_id = ${input.workspaceId} AND trashed_at IS NULL
    `);
    if ((count.rows[0]?.count ?? 0) >= 500) {
      throw new Phase2RepositoryError("FOLDER_LIMIT_REACHED", "Workspace folder limit reached.");
    }
    const id = newId();
    const result = await transaction.execute<FolderRow>(sql`
      INSERT INTO folders (id, workspace_id, name, name_normalized, created_by, updated_by)
      VALUES (${id}, ${input.workspaceId}, ${input.name}, ${input.nameNormalized},
              ${input.actorUserId}, ${input.actorUserId})
      RETURNING id, workspace_id, name, name_normalized, sort_key, created_by, updated_by,
                created_at, updated_at
    `);
    const row = result.rows[0];
    if (row === undefined) throw new Error("Folder insert returned no row.");
    return toFolderRecord(row);
  }

  public async list(database: Database, workspaceId: string): Promise<FolderRecord[]> {
    const result = await database.$client.query<FolderRow>(
      `
      SELECT id, workspace_id, name, name_normalized, sort_key, created_by, updated_by,
             created_at, updated_at
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
      RETURNING id, workspace_id, name, name_normalized, sort_key, created_by, updated_by,
                created_at, updated_at
    `);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Phase2RepositoryError("FOLDER_NOT_FOUND", "Folder does not exist.");
    }
    return toFolderRecord(row);
  }

  public async checkDelete(
    transaction: DatabaseTransaction,
    workspaceId: string,
    folderId: string,
  ): Promise<{ folder: FolderRecord; documentCount: number; canDelete: boolean }> {
    await lockWorkspace(transaction, workspaceId);
    const folder = await transaction.execute<FolderRow>(sql`
      SELECT id, workspace_id, name, name_normalized, sort_key, created_by, updated_by,
             created_at, updated_at
      FROM folders
      WHERE id = ${folderId} AND workspace_id = ${workspaceId} AND trashed_at IS NULL
      FOR UPDATE
    `);
    const row = folder.rows[0];
    if (row === undefined)
      throw new Phase2RepositoryError("FOLDER_NOT_FOUND", "Folder does not exist.");
    const count = await transaction.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM documents
      WHERE folder_id = ${folderId} AND trashed_at IS NULL
    `);
    const documentCount = count.rows[0]?.count ?? 0;
    return { folder: toFolderRecord(row), documentCount, canDelete: documentCount === 0 };
  }
}
