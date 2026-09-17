import { newId } from "@share-mind-map/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runInitAdminCli } from "../src/cli/init-admin.js";
import { runRecoverAdminCli } from "../src/cli/recover-admin.js";
import {
  type AuthTestRuntime,
  initializeDefaultAdmin,
  login,
  resetAuthTestRuntime,
  startAuthTestRuntime,
  stopAuthTestRuntime,
} from "./helpers/auth-fixtures.js";
import { RecordingCommandIO } from "./helpers/recording-command-io.js";

let runtime: AuthTestRuntime;

beforeAll(async () => {
  runtime = await startAuthTestRuntime();
}, 120_000);

beforeEach(async () => {
  await resetAuthTestRuntime(runtime);
});

afterAll(async () => {
  await stopAuthTestRuntime(runtime);
});

describe("interactive administrator operations", () => {
  it("atomically initializes the first organization graph and reveals one secret once", async () => {
    const forbiddenEnvironmentPassword = "Must-Not-Be-Used-As-Admin-Password";
    const previous = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = forbiddenEnvironmentPassword;
    const io = new RecordingCommandIO([
      "Test Organization",
      "Default Workspace",
      "Admin.One",
      "First Admin",
    ]);
    try {
      const result = await runtime.operations.initialize(io);

      expect(result.status).toBe("initialized");
      expect(io.secrets).toHaveLength(1);
      expect(io.secrets[0]?.value).toHaveLength(24);
      expect(io.secrets[0]?.value).not.toBe(forbiddenEnvironmentPassword);
      const graph = await runtime.database.$client.query<{
        organizations: string;
        workspaces: string;
        users: string;
        identities: string;
        memberships: string;
        audits: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM organizations) AS organizations,
           (SELECT count(*)::text FROM workspaces) AS workspaces,
           (SELECT count(*)::text FROM users) AS users,
           (SELECT count(*)::text FROM auth_identities) AS identities,
           (SELECT count(*)::text FROM workspace_memberships) AS memberships,
           (SELECT count(*)::text FROM audit_logs WHERE action = 'operations.admin.initialized') AS audits`,
      );
      expect(graph.rows[0]).toEqual({
        organizations: "1",
        workspaces: "1",
        users: "1",
        identities: "1",
        memberships: "1",
        audits: "1",
      });
      const identity = await runtime.database.$client.query<{
        provider_subject: string;
        password_hash: string;
        must_change_password: boolean;
      }>("SELECT provider_subject, password_hash, must_change_password FROM auth_identities");
      expect(identity.rows[0]).toMatchObject({
        provider_subject: "admin.one",
        must_change_password: true,
      });
      expect(identity.rows[0]?.password_hash).not.toContain(io.secrets[0]?.value as string);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previous;
    }
  });

  it("is idempotent and does not reveal or create anything on a repeated initialization", async () => {
    await initializeDefaultAdmin(runtime);
    const repeated = new RecordingCommandIO([
      "Other Organization",
      "Other Workspace",
      "Other.Admin",
      "Other Admin",
    ]);

    const result = await runtime.operations.initialize(repeated);

    expect(result.status).toBe("already_initialized");
    expect(repeated.secrets).toHaveLength(0);
    const counts = await runtime.database.$client.query<{ organizations: string; users: string }>(
      `SELECT (SELECT count(*)::text FROM organizations) AS organizations,
              (SELECT count(*)::text FROM users) AS users`,
    );
    expect(counts.rows[0]).toEqual({ organizations: "1", users: "1" });
  });

  it("does not mutate when initialization confirmation is declined", async () => {
    const io = new RecordingCommandIO(
      ["Test Organization", "Default Workspace", "Admin.One", "First Admin"],
      [false],
    );

    const result = await runtime.operations.initialize(io);

    expect(result.status).toBe("cancelled");
    expect(io.secrets).toHaveLength(0);
    const count = await runtime.database.$client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM organizations",
    );
    expect(count.rows[0]?.count).toBe("0");
  });

  it.each(["active", "disabled"] as const)(
    "recovers an existing %s Admin, restores login, revokes sessions, and reveals one secret",
    async (status) => {
      const { password } = await initializeDefaultAdmin(runtime);
      const existingLogin = await login(runtime, "admin.one", password);
      if (existingLogin.session === undefined) throw new Error("Initial Admin login failed");
      if (status === "disabled") {
        await runtime.database.$client.query("UPDATE users SET account_status = 'disabled'");
      }
      const io = new RecordingCommandIO(["ADMIN.ONE"]);

      const result = await runtime.operations.recover(io);

      expect(result.status).toBe("recovered");
      expect(io.secrets).toHaveLength(1);
      const recoveredPassword = io.secrets[0]?.value as string;
      const staleSession = await runtime.redis.keys("smm:auth:session:*");
      expect(staleSession).toHaveLength(0);
      const identity = await runtime.database.$client.query<{
        account_status: string;
        must_change_password: boolean;
        metadata: unknown;
        actor_user_id: string | null;
      }>(
        `SELECT u.account_status, ai.must_change_password, al.metadata, al.actor_user_id
         FROM users u
         JOIN auth_identities ai ON ai.user_id = u.id
         JOIN audit_logs al ON al.target_id = u.id
         WHERE al.action = 'operations.admin.recovered'`,
      );
      expect(identity.rows[0]).toMatchObject({
        account_status: "active",
        must_change_password: true,
        actor_user_id: null,
      });
      expect(JSON.stringify(identity.rows[0]?.metadata)).not.toContain(recoveredPassword);
      const recoveredLogin = await login(runtime, "admin.one", recoveredPassword);
      expect(recoveredLogin.response.status).toBe(201);
      expect(recoveredLogin.response.body).toMatchObject({ mustChangePassword: true });
    },
  );

  it("rejects recovery for a Reader, a revoked Admin membership, and an unknown login", async () => {
    await initializeDefaultAdmin(runtime);
    const graph = await runtime.database.$client.query<{
      organization_id: string;
      workspace_id: string;
    }>(
      `SELECT o.id AS organization_id, w.id AS workspace_id FROM organizations o
       JOIN workspaces w ON w.organization_id = o.id`,
    );
    const organizationId = graph.rows[0]?.organization_id;
    const workspaceId = graph.rows[0]?.workspace_id;
    if (organizationId === undefined || workspaceId === undefined) throw new Error("Graph missing");
    const readerId = newId();
    await runtime.database.$client.query(
      "INSERT INTO users (id, display_name) VALUES ($1, 'Reader One')",
      [readerId],
    );
    await runtime.database.$client.query(
      `INSERT INTO auth_identities
         (id, organization_id, user_id, provider, provider_subject, login_name, password_hash)
       VALUES ($1, $2, $3, 'local', 'reader.one', 'Reader.One', 'unused-test-hash')`,
      [newId(), organizationId, readerId],
    );
    await runtime.database.$client.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, 'reader', 'active')`,
      [newId(), workspaceId, readerId],
    );
    await runtime.database.$client.query(
      "UPDATE workspace_memberships SET status = 'revoked' WHERE role = 'admin'",
    );

    for (const loginName of ["reader.one", "admin.one", "missing.admin"]) {
      const io = new RecordingCommandIO([loginName]);
      await expect(runtime.operations.recover(io)).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(io.secrets).toHaveLength(0);
    }
  });

  it("defines no password option on either strict yargs command", async () => {
    const initIo = new RecordingCommandIO([]);
    const recoverIo = new RecordingCommandIO([]);

    await expect(
      runInitAdminCli(["--password", "forbidden"], runtime.operations, initIo),
    ).rejects.toThrow(/Unknown argument: password/);
    await expect(
      runRecoverAdminCli(["--password", "forbidden"], runtime.operations, recoverIo),
    ).rejects.toThrow(/Unknown argument: password/);
    expect(initIo.secrets).toHaveLength(0);
    expect(recoverIo.secrets).toHaveLength(0);
  });
});
