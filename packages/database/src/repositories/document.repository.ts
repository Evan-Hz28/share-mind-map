import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { newId } from "../id.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import type { DatabaseTransaction } from "./member.repository.js";
import { Phase2RepositoryError } from "./phase2.types.js";
import {
  Phase4RepositoryError,
  type SaveSnapshotInput,
  type SaveSnapshotResult,
  type SnapshotRecord,
} from "./phase4.types.js";

export interface DocumentRecord {
  id: string;
  workspaceId: string;
  folderId: string | null;
  name: string;
  nameNormalized: string;
  currentVersion: number;
  schemaVersion: number;
  compatibilityStatus: "full" | "partial" | "unsupported_online";
  nodeCount: number;
  imageBytes: number;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentDetail extends DocumentRecord {
  snapshot: unknown;
}

export interface DocumentListResult {
  documents: DocumentRecord[];
  nextCursor: string | null;
}

interface DocumentRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  name: string;
  name_normalized: string;
  current_version: number | string;
  schema_version: number;
  compatibility_status: "full" | "partial" | "unsupported_online";
  node_count: number;
  image_bytes: number;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DetailRow extends DocumentRow {
  snapshot_json: unknown;
}

interface SnapshotRow extends Record<string, unknown> {
  id: string;
  document_id: string;
  version: number | string;
  schema_version: number;
  snapshot_json: unknown;
  snapshot_object_key: string | null;
  snapshot_sha256: string;
  node_count: number;
  save_kind: "auto" | "manual" | "restore";
}

function snapshotNodeCount(input: SaveSnapshotInput["snapshot"]): number {
  return input.sheets.reduce((count, sheet) => count + Object.keys(sheet.nodes).length, 0);
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toDocumentRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    folderId: row.folder_id,
    name: row.name,
    nameNormalized: row.name_normalized,
    currentVersion: Number(row.current_version),
    schemaVersion: row.schema_version,
    compatibilityStatus: row.compatibility_status,
    nodeCount: row.node_count,
    imageBytes: row.image_bytes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function toSnapshotRecord(row: SnapshotRow): SnapshotRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    version: Number(row.version),
    schemaVersion: row.schema_version,
    snapshot: row.snapshot_json,
    snapshotObjectKey: row.snapshot_object_key,
    snapshotSha256: row.snapshot_sha256,
    nodeCount: row.node_count,
    saveKind: row.save_kind,
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

async function assertTargetFolder(
  transaction: DatabaseTransaction,
  workspaceId: string,
  folderId: string,
): Promise<void> {
  const result = await transaction.execute<{ id: string }>(sql`
    SELECT id FROM folders
    WHERE id = ${folderId} AND workspace_id = ${workspaceId} AND trashed_at IS NULL
    FOR UPDATE
  `);
  if (result.rows[0] === undefined) {
    throw new Phase2RepositoryError(
      "FOLDER_NOT_IN_WORKSPACE",
      "Folder does not belong to workspace.",
    );
  }
}

export class DocumentRepository {
  public async saveSnapshot(
    transaction: DatabaseTransaction,
    input: SaveSnapshotInput,
  ): Promise<SaveSnapshotResult> {
    const documentResult = await transaction.execute<DocumentRow>(sql`
      SELECT id, workspace_id, folder_id, name, name_normalized, current_version,
             schema_version, compatibility_status, node_count, image_bytes, created_by, updated_by,
             created_at, updated_at
      FROM documents
      WHERE id = ${input.documentId} AND workspace_id = ${input.workspaceId} AND trashed_at IS NULL
      FOR UPDATE
    `);
    const documentRow = documentResult.rows[0];
    if (documentRow === undefined) {
      throw new Phase2RepositoryError("DOCUMENT_NOT_FOUND", "Document does not exist.");
    }

    const requestResult = await transaction.execute<{
      base_version: number | string;
      snapshot_sha256: string;
      resulting_snapshot_id: string;
    }>(sql`
      SELECT base_version, snapshot_sha256, resulting_snapshot_id
      FROM document_save_requests
      WHERE document_id = ${input.documentId} AND idempotency_key = ${input.idempotencyKey}
    `);
    const existingRequest = requestResult.rows[0];
    if (existingRequest !== undefined) {
      if (
        Number(existingRequest.base_version) !== input.baseVersion ||
        existingRequest.snapshot_sha256 !== input.snapshotSha256
      ) {
        throw new Phase4RepositoryError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key was already used for a different snapshot.",
        );
      }
      const existingSnapshot = await transaction.execute<SnapshotRow>(sql`
        SELECT id, document_id, version, schema_version, snapshot_json, snapshot_object_key,
               snapshot_sha256, node_count, save_kind
        FROM document_snapshots
        WHERE id = ${existingRequest.resulting_snapshot_id}
      `);
      const snapshotRow = existingSnapshot.rows[0];
      if (snapshotRow === undefined) throw new Error("Idempotent snapshot is missing.");
      return {
        document: toDocumentRecord(documentRow),
        snapshot: toSnapshotRecord(snapshotRow),
        idempotent: true,
      };
    }

    if (Number(documentRow.current_version) !== input.baseVersion) {
      throw new Phase4RepositoryError(
        "DOCUMENT_VERSION_CONFLICT",
        "Document version is no longer current.",
      );
    }

    const assetIds = [...new Set(input.assetIds)];
    if (assetIds.length > 0) {
      const assetRows = await transaction.execute<{ id: string }>(sql`
        SELECT id FROM document_assets
        WHERE workspace_id = ${input.workspaceId}
          AND document_id = ${input.documentId}
          AND id = ANY(${assetIds}::uuid[])
      `);
      if (assetRows.rows.length !== assetIds.length) {
        throw new Phase4RepositoryError(
          "DOCUMENT_ASSET_INVALID",
          "Snapshot references an unknown document asset.",
        );
      }
    }

    const snapshotId = newId();
    const nextVersion = input.baseVersion + 1;
    await transaction.execute(sql`
      INSERT INTO document_snapshots
        (id, document_id, version, schema_version, snapshot_json, snapshot_object_key,
         snapshot_sha256, node_count, save_kind, history_visible, created_by)
      VALUES
        (${snapshotId}, ${input.documentId}, ${nextVersion}, ${input.snapshot.schemaVersion},
         ${input.snapshotJson === null ? null : JSON.stringify(input.snapshotJson)}::jsonb,
         ${input.snapshotObjectKey}, ${input.snapshotSha256},
         ${snapshotNodeCount(input.snapshot)},
         ${input.saveKind}, true, ${input.actorUserId})
    `);
    for (const assetId of assetIds) {
      await transaction.execute(sql`
        INSERT INTO snapshot_asset_refs (snapshot_id, asset_id)
        VALUES (${snapshotId}, ${assetId})
      `);
    }
    const updated = await transaction.execute<DocumentRow>(sql`
      UPDATE documents
      SET current_version = ${nextVersion}, schema_version = ${input.snapshot.schemaVersion},
          current_snapshot_id = ${snapshotId}, node_count = ${snapshotNodeCount(input.snapshot)},
          image_bytes = ${input.imageBytes}, updated_by = ${input.actorUserId}, updated_at = now()
      WHERE id = ${input.documentId} AND workspace_id = ${input.workspaceId} AND trashed_at IS NULL
      RETURNING id, workspace_id, folder_id, name, name_normalized, current_version,
                schema_version, compatibility_status, node_count, image_bytes, created_by, updated_by,
                created_at, updated_at
    `);
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) throw new Error("Snapshot update returned no document.");
    await transaction.execute(sql`
      INSERT INTO document_save_requests
        (id, document_id, idempotency_key, base_version, snapshot_sha256, resulting_snapshot_id)
      VALUES
        (${newId()}, ${input.documentId}, ${input.idempotencyKey}, ${input.baseVersion},
         ${input.snapshotSha256}, ${snapshotId})
    `);
    return {
      document: toDocumentRecord(updatedRow),
      snapshot: {
        id: snapshotId,
        documentId: input.documentId,
        version: nextVersion,
        schemaVersion: input.snapshot.schemaVersion,
        snapshot: input.snapshotJson,
        snapshotObjectKey: input.snapshotObjectKey,
        snapshotSha256: input.snapshotSha256,
        nodeCount: snapshotNodeCount(input.snapshot),
        saveKind: input.saveKind,
      },
      idempotent: false,
    };
  }

  public async createImported(
    transaction: DatabaseTransaction,
    input: {
      documentId: string;
      workspaceId: string;
      folderId: string | null;
      name: string;
      nameNormalized: string;
      actorUserId: string;
      snapshot: unknown;
      snapshotObjectKey: string | null;
      snapshotSha256: string;
      nodeCount: number;
      imageBytes: number;
      originalObjectKey: string;
      originalSha256: string;
      compatibilityStatus: "full" | "partial" | "unsupported_online";
      compatibilityReport: unknown;
    },
  ): Promise<DocumentRecord> {
    await lockWorkspace(transaction, input.workspaceId);
    if (input.folderId !== null)
      await assertTargetFolder(transaction, input.workspaceId, input.folderId);
    const total = await transaction.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM documents
      WHERE workspace_id = ${input.workspaceId} AND trashed_at IS NULL
    `);
    if ((total.rows[0]?.count ?? 0) >= 20_000) {
      throw new Phase2RepositoryError(
        "WORKSPACE_DOCUMENT_LIMIT_REACHED",
        "Workspace document limit reached.",
      );
    }
    if (input.folderId !== null) {
      const count = await transaction.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM documents
        WHERE folder_id = ${input.folderId} AND trashed_at IS NULL
      `);
      if ((count.rows[0]?.count ?? 0) >= 1000) {
        throw new Phase2RepositoryError(
          "FOLDER_DOCUMENT_LIMIT_REACHED",
          "Folder document limit reached.",
        );
      }
    }
    const snapshotId = newId();
    await transaction.execute(sql`
      INSERT INTO documents
        (id, workspace_id, folder_id, name, name_normalized, current_version, schema_version,
         current_snapshot_id, original_object_key, original_sha256, compatibility_status,
         compatibility_report, node_count, image_bytes, created_by, updated_by)
      VALUES
        (${input.documentId}, ${input.workspaceId}, ${input.folderId}, ${input.name}, ${input.nameNormalized},
         1, 1, NULL, ${input.originalObjectKey}, ${input.originalSha256}, ${input.compatibilityStatus},
         ${JSON.stringify(input.compatibilityReport)}::jsonb, ${input.nodeCount}, ${input.imageBytes},
         ${input.actorUserId}, ${input.actorUserId})
    `);
    await transaction.execute(sql`
      INSERT INTO document_snapshots
        (id, document_id, version, schema_version, snapshot_json, snapshot_object_key,
         snapshot_sha256, node_count, save_kind, history_visible, created_by)
      VALUES
        (${snapshotId}, ${input.documentId}, 1, 1, ${input.snapshotObjectKey === null ? JSON.stringify(input.snapshot) : null}::jsonb,
         ${input.snapshotObjectKey}, ${input.snapshotSha256}, ${input.nodeCount}, 'initial', false, ${input.actorUserId})
    `);
    const result = await transaction.execute<DocumentRow>(sql`
      UPDATE documents
      SET current_snapshot_id = ${snapshotId}, updated_at = now()
      WHERE id = ${input.documentId}
      RETURNING id, workspace_id, folder_id, name, name_normalized, current_version,
                schema_version, compatibility_status, node_count, image_bytes, created_by, updated_by, created_at, updated_at
    `);
    const row = result.rows[0];
    if (row === undefined) throw new Error("Imported document insert returned no row.");
    return toDocumentRecord(row);
  }

  public async createBlank(
    transaction: DatabaseTransaction,
    input: {
      documentId: string;
      workspaceId: string;
      folderId: string | null;
      name: string;
      nameNormalized: string;
      actorUserId: string;
      snapshot: unknown;
      nodeCount: number;
    },
  ): Promise<DocumentRecord> {
    await lockWorkspace(transaction, input.workspaceId);
    if (input.folderId !== null) {
      await assertTargetFolder(transaction, input.workspaceId, input.folderId);
      const count = await transaction.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM documents
        WHERE folder_id = ${input.folderId} AND trashed_at IS NULL
      `);
      if ((count.rows[0]?.count ?? 0) >= 1000) {
        throw new Phase2RepositoryError(
          "FOLDER_DOCUMENT_LIMIT_REACHED",
          "Folder document limit reached.",
        );
      }
    }
    const total = await transaction.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM documents
      WHERE workspace_id = ${input.workspaceId} AND trashed_at IS NULL
    `);
    if ((total.rows[0]?.count ?? 0) >= 20_000) {
      throw new Phase2RepositoryError(
        "WORKSPACE_DOCUMENT_LIMIT_REACHED",
        "Workspace document limit reached.",
      );
    }

    const documentId = input.documentId;
    const snapshotId = newId();
    const serialized = JSON.stringify(input.snapshot);
    const snapshotSha256 = createHash("sha256").update(serialized).digest("hex");
    await transaction.execute(sql`
      INSERT INTO documents
        (id, workspace_id, folder_id, name, name_normalized, current_version, schema_version,
         current_snapshot_id, compatibility_status, compatibility_report, node_count, image_bytes,
         created_by, updated_by)
      VALUES
        (${documentId}, ${input.workspaceId}, ${input.folderId}, ${input.name}, ${input.nameNormalized},
         1, 1, NULL, 'full', '{}'::jsonb, ${input.nodeCount}, 0,
         ${input.actorUserId}, ${input.actorUserId})
    `);
    await transaction.execute(sql`
      INSERT INTO document_snapshots
        (id, document_id, version, schema_version, snapshot_json, snapshot_sha256, node_count,
         save_kind, history_visible, created_by)
      VALUES
        (${snapshotId}, ${documentId}, 1, 1, ${serialized}::jsonb, ${snapshotSha256},
         ${input.nodeCount}, 'initial', false, ${input.actorUserId})
    `);
    const result = await transaction.execute<DocumentRow>(sql`
      UPDATE documents
      SET current_snapshot_id = ${snapshotId}, updated_at = now()
      WHERE id = ${documentId}
      RETURNING id, workspace_id, folder_id, name, name_normalized, current_version,
                schema_version, compatibility_status, node_count, image_bytes, created_by, updated_by, created_at, updated_at
    `);
    const row = result.rows[0];
    if (row === undefined) throw new Error("Document insert returned no row.");
    return toDocumentRecord(row);
  }

  public async list(
    database: Database,
    input: {
      workspaceId: string;
      sort: "updatedAt" | "name";
      limit: number;
      cursor: string | null;
    },
  ): Promise<DocumentListResult> {
    const limit = Math.min(Math.max(input.limit, 1), 100);
    const values: unknown[] = [input.workspaceId];
    let cursorClause = "";
    if (input.cursor !== null) {
      const cursor = decodeCursor(input.cursor);
      values.push(cursor.sortValue, cursor.id);
      const sortColumn = input.sort === "name" ? "name_normalized" : "updated_at";
      const direction = input.sort === "name" ? ">" : "<";
      cursorClause = `AND (${sortColumn}, id) ${direction} ($2, $3::uuid)`;
    }
    values.push(limit + 1);
    const sort = input.sort === "name" ? "name_normalized ASC, id ASC" : "updated_at DESC, id DESC";
    const result = await database.$client.query<DocumentRow>(
      `SELECT id, workspace_id, folder_id, name, name_normalized, current_version,
              schema_version, compatibility_status, node_count, image_bytes, created_by, updated_by, created_at, updated_at
       FROM documents
       WHERE workspace_id = $1 AND trashed_at IS NULL ${cursorClause}
       ORDER BY ${sort}
       LIMIT $${String(values.length)}`,
      values,
    );
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const documents = rows.map(toDocumentRecord);
    const last = documents.at(-1);
    let nextCursor: string | null = null;
    if (hasMore && last !== undefined) {
      nextCursor = encodeCursor({
        sortValue: input.sort === "name" ? last.nameNormalized : last.updatedAt.toISOString(),
        id: last.id,
      });
    }
    return { documents, nextCursor };
  }

  public async findDetail(
    database: Database,
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentDetail | null> {
    const result = await database.$client.query<DetailRow>(
      `SELECT d.id, d.workspace_id, d.folder_id, d.name, d.name_normalized, d.current_version,
              d.schema_version, d.compatibility_status, d.node_count, d.image_bytes, d.created_by, d.updated_by,
              d.created_at, d.updated_at, s.snapshot_json
       FROM documents d
       LEFT JOIN document_snapshots s ON s.id = d.current_snapshot_id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.trashed_at IS NULL`,
      [documentId, workspaceId],
    );
    const row = result.rows[0];
    return row === undefined ? null : { ...toDocumentRecord(row), snapshot: row.snapshot_json };
  }

  public async rename(
    transaction: DatabaseTransaction,
    input: {
      workspaceId: string;
      documentId: string;
      name: string;
      nameNormalized: string;
      actorUserId: string;
    },
  ): Promise<DocumentRecord> {
    await lockWorkspace(transaction, input.workspaceId);
    const result = await transaction.execute<DocumentRow>(sql`
      UPDATE documents
      SET name = ${input.name}, name_normalized = ${input.nameNormalized},
          updated_by = ${input.actorUserId}, updated_at = now()
      WHERE id = ${input.documentId} AND workspace_id = ${input.workspaceId} AND trashed_at IS NULL
      RETURNING id, workspace_id, folder_id, name, name_normalized, current_version,
                schema_version, compatibility_status, node_count, image_bytes, created_by, updated_by, created_at, updated_at
    `);
    const row = result.rows[0];
    if (row === undefined)
      throw new Phase2RepositoryError("DOCUMENT_NOT_FOUND", "Document does not exist.");
    return toDocumentRecord(row);
  }

  public async move(
    transaction: DatabaseTransaction,
    input: {
      workspaceId: string;
      documentId: string;
      folderId: string | null;
      actorUserId: string;
    },
  ): Promise<DocumentRecord> {
    await lockWorkspace(transaction, input.workspaceId);
    if (input.folderId !== null) {
      await assertTargetFolder(transaction, input.workspaceId, input.folderId);
      const count = await transaction.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM documents
        WHERE folder_id = ${input.folderId} AND trashed_at IS NULL AND id <> ${input.documentId}
      `);
      if ((count.rows[0]?.count ?? 0) >= 1000) {
        throw new Phase2RepositoryError(
          "FOLDER_DOCUMENT_LIMIT_REACHED",
          "Folder document limit reached.",
        );
      }
    }
    const result = await transaction.execute<DocumentRow>(sql`
      UPDATE documents
      SET folder_id = ${input.folderId}, updated_by = ${input.actorUserId}, updated_at = now()
      WHERE id = ${input.documentId} AND workspace_id = ${input.workspaceId} AND trashed_at IS NULL
      RETURNING id, workspace_id, folder_id, name, name_normalized, current_version,
                schema_version, compatibility_status, node_count, image_bytes, created_by, updated_by, created_at, updated_at
    `);
    const row = result.rows[0];
    if (row === undefined)
      throw new Phase2RepositoryError("DOCUMENT_NOT_FOUND", "Document does not exist.");
    return toDocumentRecord(row);
  }
}
