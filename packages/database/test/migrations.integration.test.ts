import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "../src/index.js";
import {
  type DatabaseTestRuntime,
  resetDatabase,
  startDatabaseTestRuntime,
  stopDatabaseTestRuntime,
} from "./support.js";

let runtime: DatabaseTestRuntime;

async function migrationNames(): Promise<string[]> {
  const result = await runtime.db.$client.query<{ name: string }>(
    "SELECT name FROM drizzle.__drizzle_migrations ORDER BY id",
  );
  return result.rows.map((row) => row.name);
}

beforeAll(async () => {
  runtime = await startDatabaseTestRuntime();
}, 120_000);

afterAll(async () => {
  await stopDatabaseTestRuntime(runtime);
});

beforeEach(async () => {
  await resetDatabase(runtime);
});

describe("database migrations", () => {
  it("migrates an empty database and treats repeated migration as a no-op", async () => {
    await migrateDatabase(runtime.db);
    const first = await migrationNames();

    await migrateDatabase(runtime.db);

    expect(await migrationNames()).toEqual(first);
    expect(first).toEqual([
      "0000_phase1_identity",
      "0001_phase2_workspace",
      "0002_phase3_import_export",
    ]);
  });

  it("uses a Drizzle-compatible migration journal", async () => {
    await migrateDatabase(runtime.db);
    const result = await runtime.db.$client.query<{
      column_name: string;
      data_type: string;
      is_nullable: "YES" | "NO";
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
       ORDER BY ordinal_position`,
    );

    expect(result.rows).toEqual([
      { column_name: "id", data_type: "integer", is_nullable: "NO" },
      { column_name: "name", data_type: "text", is_nullable: "YES" },
      { column_name: "hash", data_type: "text", is_nullable: "NO" },
      { column_name: "created_at", data_type: "bigint", is_nullable: "NO" },
    ]);
  });

  it("serializes concurrent startup migration attempts", async () => {
    await Promise.all([migrateDatabase(runtime.db), migrateDatabase(runtime.db)]);

    expect(await migrationNames()).toEqual([
      "0000_phase1_identity",
      "0001_phase2_workspace",
      "0002_phase3_import_export",
    ]);
  });

  it("creates all phase 1 through phase 3 tables", async () => {
    await migrateDatabase(runtime.db);
    const result = await runtime.db.$client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "audit_logs",
      "auth_identities",
      "document_assets",
      "document_snapshots",
      "documents",
      "edit_permission_requests",
      "export_jobs",
      "folders",
      "import_batches",
      "import_jobs",
      "notification_outbox",
      "notifications",
      "organizations",
      "users",
      "workspace_memberships",
      "workspaces",
    ]);
  });

  it("stores every phase 1 instant as timestamp with time zone", async () => {
    await migrateDatabase(runtime.db);
    const result = await runtime.db.$client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type = 'timestamp with time zone'
       ORDER BY table_name, column_name`,
    );

    expect(result.rows).toEqual(
      expect.arrayContaining([
        { table_name: "audit_logs", column_name: "created_at" },
        { table_name: "auth_identities", column_name: "created_at" },
        { table_name: "auth_identities", column_name: "password_changed_at" },
        { table_name: "auth_identities", column_name: "updated_at" },
        { table_name: "organizations", column_name: "created_at" },
        { table_name: "organizations", column_name: "updated_at" },
        { table_name: "users", column_name: "created_at" },
        { table_name: "users", column_name: "last_login_at" },
        { table_name: "users", column_name: "updated_at" },
        { table_name: "workspace_memberships", column_name: "created_at" },
        { table_name: "workspace_memberships", column_name: "granted_at" },
        { table_name: "workspace_memberships", column_name: "revoked_at" },
        { table_name: "workspace_memberships", column_name: "updated_at" },
        { table_name: "workspaces", column_name: "created_at" },
        { table_name: "workspaces", column_name: "updated_at" },
        { table_name: "document_snapshots", column_name: "created_at" },
        { table_name: "documents", column_name: "created_at" },
        { table_name: "documents", column_name: "updated_at" },
        { table_name: "edit_permission_requests", column_name: "created_at" },
        { table_name: "edit_permission_requests", column_name: "requested_at" },
        { table_name: "edit_permission_requests", column_name: "updated_at" },
        { table_name: "folders", column_name: "created_at" },
        { table_name: "folders", column_name: "updated_at" },
        { table_name: "notification_outbox", column_name: "available_at" },
        { table_name: "notification_outbox", column_name: "created_at" },
        { table_name: "notification_outbox", column_name: "updated_at" },
        { table_name: "notifications", column_name: "created_at" },
      ]),
    );
  });
});
