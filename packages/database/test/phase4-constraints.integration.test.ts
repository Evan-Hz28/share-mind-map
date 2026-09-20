import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "../src/index.js";
import {
  type DatabaseTestRuntime,
  startDatabaseTestRuntime,
  stopDatabaseTestRuntime,
} from "./support.js";

let runtime: DatabaseTestRuntime;
let workspaceId: string;
let userId: string;
let documentId: string;
let otherDocumentId: string;
let snapshotId: string;
let otherSnapshotId: string;
let assetId: string;

beforeAll(async () => {
  runtime = await startDatabaseTestRuntime();
  await migrateDatabase(runtime.db);
  const organizationId = uuidv7();
  workspaceId = uuidv7();
  userId = uuidv7();
  documentId = uuidv7();
  otherDocumentId = uuidv7();
  snapshotId = uuidv7();
  otherSnapshotId = uuidv7();
  assetId = uuidv7();

  await runtime.db.$client.query(
    "INSERT INTO organizations (id, name) VALUES ($1, 'Phase 4 org')",
    [organizationId],
  );
  await runtime.db.$client.query(
    "INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Phase 4 workspace')",
    [workspaceId, organizationId],
  );
  await runtime.db.$client.query(
    "INSERT INTO users (id, display_name) VALUES ($1, 'Phase 4 user')",
    [userId],
  );
  const documentFixtures = [
    [documentId, "Document one", snapshotId],
    [otherDocumentId, "Document two", otherSnapshotId],
  ] as const;
  for (const [id, name] of documentFixtures) {
    await runtime.db.$client.query(
      `INSERT INTO documents
       (id, workspace_id, name, name_normalized, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [id, workspaceId, name, name.toLowerCase(), userId],
    );
  }
  for (const [id, owner] of [
    [snapshotId, documentId],
    [otherSnapshotId, otherDocumentId],
  ]) {
    await runtime.db.$client.query(
      `INSERT INTO document_snapshots
       (id, document_id, version, schema_version, snapshot_json, snapshot_sha256, node_count, save_kind, created_by)
       VALUES ($1, $2, 1, 1, '{}'::jsonb, repeat('a', 64), 1, 'initial', $3)`,
      [id, owner, userId],
    );
  }
  await runtime.db.$client.query("UPDATE documents SET current_snapshot_id = $1 WHERE id = $2", [
    snapshotId,
    documentId,
  ]);
  await runtime.db.$client.query("UPDATE documents SET current_snapshot_id = $1 WHERE id = $2", [
    otherSnapshotId,
    otherDocumentId,
  ]);
  await runtime.db.$client.query(
    `INSERT INTO document_assets
     (id, workspace_id, document_id, asset_kind, object_key, media_type, byte_size, sha256)
     VALUES ($1, $2, $3, 'image', 'org/test/image', 'image/png', 4, repeat('b', 64))`,
    [assetId, workspaceId, documentId],
  );
}, 120_000);

afterAll(async () => {
  await stopDatabaseTestRuntime(runtime);
});

describe("phase 4 database constraints", () => {
  it("requires the phase 4 tables and save-request columns", async () => {
    const result = await runtime.db.$client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('snapshot_asset_refs', 'document_save_requests')
       ORDER BY table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "document_save_requests",
      "snapshot_asset_refs",
    ]);
  });

  it("accepts one snapshot asset reference and rejects duplicates", async () => {
    await runtime.db.$client.query(
      "INSERT INTO snapshot_asset_refs (snapshot_id, asset_id) VALUES ($1, $2)",
      [snapshotId, assetId],
    );
    await expect(
      runtime.db.$client.query(
        "INSERT INTO snapshot_asset_refs (snapshot_id, asset_id) VALUES ($1, $2)",
        [snapshotId, assetId],
      ),
    ).rejects.toMatchObject({ constraint: "snapshot_asset_refs_pkey" });
  });

  it("rejects an asset reference when the snapshot belongs to another document", async () => {
    await expect(
      runtime.db.$client.query(
        "INSERT INTO snapshot_asset_refs (snapshot_id, asset_id) VALUES ($1, $2)",
        [otherSnapshotId, assetId],
      ),
    ).rejects.toMatchObject({ constraint: "snapshot_asset_refs_document_asset_ck" });
  });

  it("rejects duplicate idempotency keys for one document", async () => {
    await runtime.db.$client.query(
      `INSERT INTO document_save_requests
       (id, document_id, idempotency_key, base_version, snapshot_sha256, resulting_snapshot_id)
       VALUES ($1, $2, 'save-1', 1, repeat('c', 64), $3)`,
      [uuidv7(), documentId, snapshotId],
    );
    await expect(
      runtime.db.$client.query(
        `INSERT INTO document_save_requests
         (id, document_id, idempotency_key, base_version, snapshot_sha256, resulting_snapshot_id)
         VALUES ($1, $2, 'save-1', 1, repeat('c', 64), $3)`,
        [uuidv7(), documentId, snapshotId],
      ),
    ).rejects.toMatchObject({ constraint: "document_save_requests_document_key_uq" });
  });
});
