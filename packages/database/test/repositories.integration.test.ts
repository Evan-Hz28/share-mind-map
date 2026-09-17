import { v7 as uuidv7 } from "uuid";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AuditRepository,
  IdentityRepository,
  MemberRepository,
  migrateDatabase,
} from "../src/index.js";
import {
  type DatabaseTestRuntime,
  startDatabaseTestRuntime,
  stopDatabaseTestRuntime,
} from "./support.js";

let runtime: DatabaseTestRuntime;
let organizationId: string;
let workspaceId: string;
let userId: string;
let identityId: string;
let membershipId: string;

beforeAll(async () => {
  runtime = await startDatabaseTestRuntime();
  await migrateDatabase(runtime.db);
  organizationId = uuidv7();
  workspaceId = uuidv7();
  userId = uuidv7();
  identityId = uuidv7();
  membershipId = uuidv7();
  await runtime.db.$client.query(
    `INSERT INTO organizations (id, name, storage_quota_bytes)
     VALUES ($1, 'Repository organization', 10737418240)`,
    [organizationId],
  );
  await runtime.db.$client.query(
    `INSERT INTO workspaces (id, organization_id, name)
     VALUES ($1, $2, 'Repository workspace')`,
    [workspaceId, organizationId],
  );
  await runtime.db.$client.query(
    `INSERT INTO users (id, display_name, account_status)
     VALUES ($1, 'First Admin', 'active')`,
    [userId],
  );
  await runtime.db.$client.query(
    `INSERT INTO auth_identities
       (id, organization_id, user_id, provider, provider_subject, login_name, password_hash)
     VALUES ($1, $2, $3, 'local', 'admin.one', 'Admin.One', 'test-hash')`,
    [identityId, organizationId, userId],
  );
  await runtime.db.$client.query(
    `INSERT INTO workspace_memberships
       (id, workspace_id, user_id, role, status)
     VALUES ($1, $2, $3, 'admin', 'active')`,
    [membershipId, workspaceId, userId],
  );
}, 120_000);

afterAll(async () => {
  await stopDatabaseTestRuntime(runtime);
});

describe("phase 1 repositories", () => {
  it("finds a local identity by normalized subject with its active principal", async () => {
    const repository = new IdentityRepository(runtime.db);

    const principal = await repository.findLocalBySubject(organizationId, "ADMIN.ONE");

    expect(principal).toMatchObject({
      identity: {
        id: identityId,
        provider: "local",
        providerSubject: "admin.one",
        loginName: "Admin.One",
      },
      user: { id: userId, displayName: "First Admin", accountStatus: "active" },
      membership: {
        id: membershipId,
        workspaceId,
        role: "admin",
        status: "active",
      },
    });
  });

  it("does not attach a membership from another organization", async () => {
    const otherOrganizationId = uuidv7();
    const otherWorkspaceId = uuidv7();
    const crossOrganizationUserId = uuidv7();
    await runtime.db.$client.query(
      `INSERT INTO organizations (id, name, storage_quota_bytes)
       VALUES ($1, 'Other organization', 10737418240)`,
      [otherOrganizationId],
    );
    await runtime.db.$client.query(
      `INSERT INTO workspaces (id, organization_id, name)
       VALUES ($1, $2, 'Other workspace')`,
      [otherWorkspaceId, otherOrganizationId],
    );
    await runtime.db.$client.query(
      `INSERT INTO users (id, display_name, account_status)
       VALUES ($1, 'Cross organization user', 'active')`,
      [crossOrganizationUserId],
    );
    await runtime.db.$client.query(
      `INSERT INTO auth_identities
         (id, organization_id, user_id, provider, provider_subject, login_name, password_hash)
       VALUES ($1, $2, $3, 'local', 'cross.org', 'cross.org', 'test-hash')`,
      [uuidv7(), organizationId, crossOrganizationUserId],
    );
    await runtime.db.$client.query(
      `INSERT INTO workspace_memberships
         (id, workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, 'admin', 'active')`,
      [uuidv7(), otherWorkspaceId, crossOrganizationUserId],
    );

    const repository = new IdentityRepository(runtime.db);
    expect(await repository.findLocalBySubject(organizationId, "cross.org")).toBeNull();
  });

  it("lists members and counts active administrators inside a transaction", async () => {
    const repository = new MemberRepository(runtime.db);

    expect(await repository.list(workspaceId)).toEqual([
      expect.objectContaining({
        id: membershipId,
        userId,
        displayName: "First Admin",
        loginName: "Admin.One",
        accountStatus: "active",
        mustChangePassword: false,
        role: "admin",
        status: "active",
      }),
    ]);
    await runtime.db.transaction(async (transaction) => {
      expect(await repository.lockById(transaction, membershipId)).toMatchObject({
        id: membershipId,
        role: "admin",
        status: "active",
      });
      expect(await repository.countActiveAdmins(transaction, workspaceId)).toBe(1);
    });
  });

  it("rolls back member mutations with the surrounding transaction", async () => {
    const repository = new MemberRepository(runtime.db);

    await expect(
      runtime.db.transaction(async (transaction) => {
        await repository.lockById(transaction, membershipId);
        await transaction.execute(sql`
          UPDATE workspace_memberships
          SET status = 'revoked', revoked_at = now(), updated_at = now()
          WHERE id = ${membershipId}
        `);
        throw new Error("rollback requested");
      }),
    ).rejects.toThrow("rollback requested");

    expect(await repository.list(workspaceId)).toEqual([
      expect.objectContaining({ id: membershipId, status: "active", revokedAt: null }),
    ]);
  });

  it("appends safe audit metadata and exposes no mutation methods", async () => {
    const repository = new AuditRepository();
    const auditId = uuidv7();

    await runtime.db.transaction(async (transaction) => {
      await repository.append(transaction, {
        id: auditId,
        organizationId,
        workspaceId,
        actorUserId: userId,
        actorSessionId: "session-reference",
        action: "admin.member.created",
        targetType: "workspace_membership",
        targetId: membershipId,
        result: "success",
        requestId: "request-1",
        fromVersion: null,
        toVersion: null,
        metadata: { role: "admin" },
      });
    });

    const result = await runtime.db.$client.query<{
      id: string;
      action: string;
      metadata: { role: string };
    }>("SELECT id, action, metadata FROM audit_logs WHERE id = $1", [auditId]);
    expect(result.rows).toEqual([
      { id: auditId, action: "admin.member.created", metadata: { role: "admin" } },
    ]);
    expect("update" in repository).toBe(false);
    expect("delete" in repository).toBe(false);
  });

  it("rolls back audit appends with the surrounding transaction", async () => {
    const repository = new AuditRepository();
    const auditId = uuidv7();

    await expect(
      runtime.db.transaction(async (transaction) => {
        await repository.append(transaction, {
          id: auditId,
          organizationId,
          workspaceId,
          actorUserId: null,
          actorSessionId: null,
          action: "operations.rollback.proof",
          targetType: null,
          targetId: null,
          result: "failure",
          requestId: "request-rollback",
          fromVersion: null,
          toVersion: null,
          metadata: {},
        });
        throw new Error("rollback audit");
      }),
    ).rejects.toThrow("rollback audit");

    const result = await runtime.db.$client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_logs WHERE id = $1",
      [auditId],
    );
    expect(result.rows).toEqual([{ count: "0" }]);
  });
});
