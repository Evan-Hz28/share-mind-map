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

beforeAll(async () => {
  runtime = await startDatabaseTestRuntime();
  await migrateDatabase(runtime.db);
  const organizationId = uuidv7();
  workspaceId = uuidv7();
  userId = uuidv7();
  await runtime.db.$client.query(
    "INSERT INTO organizations (id, name) VALUES ($1, 'Phase 3 org')",
    [organizationId],
  );
  await runtime.db.$client.query(
    "INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Phase 3 workspace')",
    [workspaceId, organizationId],
  );
  await runtime.db.$client.query(
    "INSERT INTO users (id, display_name) VALUES ($1, 'Phase 3 user')",
    [userId],
  );
}, 120_000);

afterAll(async () => {
  await stopDatabaseTestRuntime(runtime);
});

describe("phase 3 database constraints", () => {
  it("creates import, asset, and export tables in the forward migration", async () => {
    const result = await runtime.db.$client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining(["document_assets", "export_jobs", "import_batches", "import_jobs"]),
    );
  });

  it("rejects a duplicate active target name within one workspace", async () => {
    const batchId = uuidv7();
    await runtime.db.$client.query(
      `INSERT INTO import_batches (id, workspace_id, requested_by, total_jobs)
       VALUES ($1, $2, $3, 2)`,
      [batchId, workspaceId, userId],
    );
    await runtime.db.$client.query(
      `INSERT INTO import_jobs
       (id, batch_id, workspace_id, requested_by, client_file_name, target_name, target_name_normalized)
       VALUES ($1, $2, $3, $4, 'one.xmind', 'Same name', 'same name')`,
      [uuidv7(), batchId, workspaceId, userId],
    );
    await expect(
      runtime.db.$client.query(
        `INSERT INTO import_jobs
         (id, batch_id, workspace_id, requested_by, client_file_name, target_name, target_name_normalized)
         VALUES ($1, $2, $3, $4, 'two.xmind', ' same name ', 'same name')`,
        [uuidv7(), batchId, workspaceId, userId],
      ),
    ).rejects.toMatchObject({ constraint: "import_jobs_workspace_target_name_active_uq" });
  });

  it("requires exactly one stored object representation for an asset", async () => {
    const documentId = uuidv7();
    await runtime.db.$client.query(
      `INSERT INTO documents
       (id, workspace_id, name, name_normalized, created_by, updated_by)
       VALUES ($1, $2, 'Asset document', 'asset document', $3, $3)`,
      [documentId, workspaceId, userId],
    );
    await expect(
      runtime.db.$client.query(
        `INSERT INTO document_assets
         (id, workspace_id, document_id, asset_kind, object_key, byte_size, sha256, media_type)
         VALUES ($1, $2, $3, 'image', NULL, 1, repeat('a', 64), 'image/png')`,
        [uuidv7(), workspaceId, documentId],
      ),
    ).rejects.toMatchObject({ constraint: "document_assets_object_key_ck" });
  });
});
