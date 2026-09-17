import { v7 as uuidv7, validate as validateUuid, version as uuidVersion } from "uuid";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditLogs,
  authIdentities,
  migrateDatabase,
  newId,
  organizations,
  users,
  workspaceMemberships,
  workspaces,
} from "../src/index.js";
import {
  type DatabaseTestRuntime,
  startDatabaseTestRuntime,
  stopDatabaseTestRuntime,
} from "./support.js";

let runtime: DatabaseTestRuntime;
let organizationId: string;
let workspaceId: string;

async function createUser(displayName = "Test member"): Promise<string> {
  const id = uuidv7();
  await runtime.db.$client.query(
    `INSERT INTO users (id, display_name, account_status)
     VALUES ($1, $2, 'active')`,
    [id, displayName],
  );
  return id;
}

async function insertIdentity(input: {
  userId: string;
  provider: "local" | "lark";
  subject: string;
  loginName: string | null;
  passwordHash: string | null;
}) {
  return runtime.db.$client.query(
    `INSERT INTO auth_identities
       (id, organization_id, user_id, provider, provider_subject, login_name, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      uuidv7(),
      organizationId,
      input.userId,
      input.provider,
      input.subject,
      input.loginName,
      input.passwordHash,
    ],
  );
}

beforeAll(async () => {
  runtime = await startDatabaseTestRuntime();
  await migrateDatabase(runtime.db);
  organizationId = uuidv7();
  workspaceId = uuidv7();
  await runtime.db.$client.query(
    `INSERT INTO organizations (id, name, storage_quota_bytes)
     VALUES ($1, 'Test organization', 10737418240)`,
    [organizationId],
  );
  await runtime.db.$client.query(
    `INSERT INTO workspaces (id, organization_id, name)
     VALUES ($1, $2, 'Test workspace')`,
    [workspaceId, organizationId],
  );
}, 120_000);

afterAll(async () => {
  await stopDatabaseTestRuntime(runtime);
});

describe("phase 1 database constraints", () => {
  it("keeps ORM constraint and default metadata aligned with the migration", () => {
    const tableConfigs = [
      getTableConfig(organizations),
      getTableConfig(workspaces),
      getTableConfig(users),
      getTableConfig(authIdentities),
      getTableConfig(workspaceMemberships),
      getTableConfig(auditLogs),
    ];
    const constraintNames = tableConfigs.flatMap((config) => [
      ...config.checks.map((constraint) => constraint.name),
      ...config.uniqueConstraints.map((constraint) => constraint.getName()),
      ...config.foreignKeys.map((constraint) => constraint.getName()),
    ]);

    expect(constraintNames).toEqual(
      expect.arrayContaining([
        "workspaces_organization_fk",
        "users_account_status_ck",
        "users_created_by_fk",
        "auth_identities_org_provider_subject_uq",
        "auth_identities_user_provider_uq",
        "auth_identities_local_credentials_ck",
        "workspace_memberships_workspace_user_uq",
        "workspace_memberships_role_ck",
        "audit_logs_organization_fk",
        "audit_logs_workspace_fk",
        "audit_logs_actor_user_fk",
        "audit_logs_result_ck",
      ]),
    );
    expect(organizations.trashRetentionDays.hasDefault).toBe(true);
    expect(organizations.notificationRetentionDays.hasDefault).toBe(true);
    expect(authIdentities.mustChangePassword.hasDefault).toBe(true);
    expect(workspaceMemberships.status.hasDefault).toBe(true);
    expect(auditLogs.metadata.hasDefault).toBe(true);
    for (const table of tableConfigs) {
      for (const column of table.columns.filter((entry) => entry.name.endsWith("_at"))) {
        if (["last_login_at", "password_changed_at", "revoked_at"].includes(column.name)) continue;
        expect(column.hasDefault, `${table.name}.${column.name}`).toBe(true);
      }
    }
  });

  it("generates UUIDv7 identifiers", () => {
    const id = newId();

    expect(validateUuid(id)).toBe(true);
    expect(uuidVersion(id)).toBe(7);
  });

  it("enforces normalized local identity uniqueness", async () => {
    const firstUserId = await createUser("Reader one");
    const secondUserId = await createUser("Reader two");
    await insertIdentity({
      userId: firstUserId,
      provider: "local",
      subject: "reader.one",
      loginName: "Reader.One",
      passwordHash: "test-hash-one",
    });

    await expect(
      insertIdentity({
        userId: secondUserId,
        provider: "local",
        subject: "reader.one",
        loginName: "reader.one",
        passwordHash: "test-hash-two",
      }),
    ).rejects.toMatchObject({ constraint: "auth_identities_org_provider_subject_uq" });
  });

  it("rejects a non-normalized local identity subject", async () => {
    const userId = await createUser();

    await expect(
      insertIdentity({
        userId,
        provider: "local",
        subject: "Reader.Mixed",
        loginName: "Reader.Mixed",
        passwordHash: "test-hash",
      }),
    ).rejects.toMatchObject({ constraint: "auth_identities_local_subject_normalized_ck" });
  });

  it("requires local identities to contain login and hash", async () => {
    const userId = await createUser();

    await expect(
      insertIdentity({
        userId,
        provider: "local",
        subject: "missing.hash",
        loginName: "missing.hash",
        passwordHash: null,
      }),
    ).rejects.toMatchObject({ constraint: "auth_identities_local_credentials_ck" });
  });

  it("rejects a password hash for a non-local identity", async () => {
    const userId = await createUser();

    await expect(
      insertIdentity({
        userId,
        provider: "lark",
        subject: "open-id-1",
        loginName: null,
        passwordHash: "must-not-be-stored",
      }),
    ).rejects.toMatchObject({ constraint: "auth_identities_non_local_password_ck" });
  });

  it.each([
    ["owner", "active", "workspace_memberships_role_ck"],
    ["reader", "pending", "workspace_memberships_status_ck"],
  ])("rejects membership role/status %s/%s", async (role, status, constraint) => {
    const userId = await createUser();

    await expect(
      runtime.db.$client.query(
        `INSERT INTO workspace_memberships
           (id, workspace_id, user_id, role, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv7(), workspaceId, userId, role, status],
      ),
    ).rejects.toMatchObject({ constraint });
  });

  it("allows only one membership for a user and workspace", async () => {
    const userId = await createUser();
    await runtime.db.$client.query(
      `INSERT INTO workspace_memberships
         (id, workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, 'reader', 'active')`,
      [uuidv7(), workspaceId, userId],
    );

    await expect(
      runtime.db.$client.query(
        `INSERT INTO workspace_memberships
           (id, workspace_id, user_id, role, status)
         VALUES ($1, $2, $3, 'editor', 'active')`,
        [uuidv7(), workspaceId, userId],
      ),
    ).rejects.toMatchObject({ constraint: "workspace_memberships_workspace_user_uq" });
  });

  it("allows exactly one winner for concurrent duplicate identities", async () => {
    const firstUserId = await createUser("Concurrent one");
    const secondUserId = await createUser("Concurrent two");
    const results = await Promise.allSettled([
      insertIdentity({
        userId: firstUserId,
        provider: "local",
        subject: "concurrent.reader",
        loginName: "Concurrent.Reader",
        passwordHash: "test-hash-one",
      }),
      insertIdentity({
        userId: secondUserId,
        provider: "local",
        subject: "concurrent.reader",
        loginName: "concurrent.reader",
        passwordHash: "test-hash-two",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    const reason: unknown = rejected?.status === "rejected" ? rejected.reason : undefined;
    expect(reason).toMatchObject({ constraint: "auth_identities_org_provider_subject_uq" });
  });

  it.each([
    ["organization", "organization_id", uuidv7(), "audit_logs_organization_fk"],
    ["workspace", "workspace_id", uuidv7(), "audit_logs_workspace_fk"],
    ["actor", "actor_user_id", uuidv7(), "audit_logs_actor_user_fk"],
  ])(
    "rejects an audit row with a missing %s reference",
    async (_name, column, value, constraint) => {
      const query =
        column === "organization_id"
          ? {
              text: `INSERT INTO audit_logs
                     (id, organization_id, action, result, request_id, metadata)
                   VALUES ($1, $2, 'test.invalid-reference', 'failure', 'request-fk', '{}')`,
              values: [uuidv7(), value],
            }
          : {
              text: `INSERT INTO audit_logs
                     (id, organization_id, ${column}, action, result, request_id, metadata)
                   VALUES ($1, $2, $3, 'test.invalid-reference', 'failure', 'request-fk', '{}')`,
              values: [uuidv7(), organizationId, value],
            };
      await expect(runtime.db.$client.query(query.text, query.values)).rejects.toMatchObject({
        constraint,
      });
    },
  );
});
