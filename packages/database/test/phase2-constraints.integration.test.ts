import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "../src/index.js";
import {
  type DatabaseTestRuntime,
  startDatabaseTestRuntime,
  stopDatabaseTestRuntime,
} from "./support.js";

let runtime: DatabaseTestRuntime;
let organizationId: string;
let workspaceId: string;
let userId: string;

beforeAll(async () => {
  runtime = await startDatabaseTestRuntime();
  await migrateDatabase(runtime.db);
  organizationId = uuidv7();
  workspaceId = uuidv7();
  userId = uuidv7();
  await runtime.db.$client.query(
    "INSERT INTO organizations (id, name) VALUES ($1, 'Phase 2 organization')",
    [organizationId],
  );
  await runtime.db.$client.query(
    "INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Phase 2 workspace')",
    [workspaceId, organizationId],
  );
  await runtime.db.$client.query(
    "INSERT INTO users (id, display_name) VALUES ($1, 'Phase 2 user')",
    [userId],
  );
}, 120_000);

afterAll(async () => {
  await stopDatabaseTestRuntime(runtime);
});

describe("phase 2 database constraints", () => {
  it("allows one pending permission request and rejects a duplicate", async () => {
    await runtime.db.$client.query(
      `INSERT INTO edit_permission_requests (id, workspace_id, requester_id)
       VALUES ($1, $2, $3)`,
      [uuidv7(), workspaceId, userId],
    );

    await expect(
      runtime.db.$client.query(
        `INSERT INTO edit_permission_requests (id, workspace_id, requester_id)
         VALUES ($1, $2, $3)`,
        [uuidv7(), workspaceId, userId],
      ),
    ).rejects.toMatchObject({ constraint: "edit_permission_requests_pending_uq" });
  });

  it("permits a new request after the first request reaches a terminal state", async () => {
    await runtime.db.$client.query(
      `UPDATE edit_permission_requests
       SET status = 'rejected', decided_by = $1, decided_at = now()
       WHERE workspace_id = $2 AND requester_id = $3`,
      [userId, workspaceId, userId],
    );
    await expect(
      runtime.db.$client.query(
        `INSERT INTO edit_permission_requests (id, workspace_id, requester_id)
         VALUES ($1, $2, $3)`,
        [uuidv7(), workspaceId, userId],
      ),
    ).resolves.toBeDefined();
  });

  it("enforces active folder and document name uniqueness", async () => {
    const folderId = uuidv7();
    await runtime.db.$client.query(
      `INSERT INTO folders (id, workspace_id, name, name_normalized, created_by, updated_by)
       VALUES ($1, $2, 'Folder', 'folder', $3, $3)`,
      [folderId, workspaceId, userId],
    );
    await expect(
      runtime.db.$client.query(
        `INSERT INTO folders (id, workspace_id, name, name_normalized, created_by, updated_by)
         VALUES ($1, $2, ' folder ', 'folder', $3, $3)`,
        [uuidv7(), workspaceId, userId],
      ),
    ).rejects.toMatchObject({ constraint: "folders_workspace_parent_name_active_uq" });

    const documentId = uuidv7();
    await runtime.db.$client.query(
      `INSERT INTO documents
         (id, workspace_id, folder_id, name, name_normalized, created_by, updated_by)
       VALUES ($1, $2, $3, 'Doc', 'doc', $4, $4)`,
      [documentId, workspaceId, folderId, userId],
    );
    await expect(
      runtime.db.$client.query(
        `INSERT INTO documents
           (id, workspace_id, name, name_normalized, created_by, updated_by)
         VALUES ($1, $2, 'doc', 'doc', $3, $3)`,
        [uuidv7(), workspaceId, userId],
      ),
    ).rejects.toMatchObject({ constraint: "documents_workspace_name_active_uq" });
  });

  it("requires exactly one snapshot storage representation", async () => {
    const documentId = uuidv7();
    await runtime.db.$client.query(
      `INSERT INTO documents
         (id, workspace_id, name, name_normalized, created_by, updated_by)
       VALUES ($1, $2, 'Snapshot doc', 'snapshot doc', $3, $3)`,
      [documentId, workspaceId, userId],
    );
    await expect(
      runtime.db.$client.query(
        `INSERT INTO document_snapshots
           (id, document_id, version, schema_version, snapshot_sha256, node_count, save_kind, created_by)
         VALUES ($1, $2, 1, 1, repeat('a', 64), 1, 'initial', $3)`,
        [uuidv7(), documentId, userId],
      ),
    ).rejects.toMatchObject({ constraint: "document_snapshots_storage_ck" });
  });
});
