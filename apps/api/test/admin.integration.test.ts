import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type AuthenticatedSession,
  type AuthTestRuntime,
  authenticatedAdmin,
  changePassword,
  login,
  resetAuthTestRuntime,
  responseBody,
  startAuthTestRuntime,
  stopAuthTestRuntime,
} from "./helpers/auth-fixtures.js";

let runtime: AuthTestRuntime;
let admin: AuthenticatedSession;

interface CreatedMemberBody {
  member: {
    id: string;
    userId: string;
    displayName: string;
    loginName: string;
    role: string;
    accountStatus: string;
    mustChangePassword: boolean;
    lastLoginAt: string | null;
  };
  temporaryPassword: string;
}

beforeAll(async () => {
  runtime = await startAuthTestRuntime();
}, 120_000);

beforeEach(async () => {
  await resetAuthTestRuntime(runtime);
  admin = await authenticatedAdmin(runtime);
});

afterAll(async () => {
  await stopAuthTestRuntime(runtime);
});

async function createMember(loginName: string, displayName = "Reader One") {
  return request(runtime.server)
    .post("/api/v1/admin/members")
    .set("Cookie", admin.cookie)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({ loginName, displayName });
}

async function changeStatus(
  actor: AuthenticatedSession,
  membershipId: string,
  status: "active" | "disabled",
) {
  return request(runtime.server)
    .patch(`/api/v1/admin/members/${membershipId}/account-status`)
    .set("Cookie", actor.cookie)
    .set("X-CSRF-Token", actor.csrfToken)
    .send({ status });
}

describe("phase 1 administrator member operations", () => {
  it("creates only a Reader and exposes the temporary password exactly once", async () => {
    const response = await createMember("Reader.One");
    const body = responseBody(response) as CreatedMemberBody;
    const temporaryPassword = body.temporaryPassword;

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      member: {
        displayName: "Reader One",
        loginName: "Reader.One",
        role: "reader",
        accountStatus: "active",
        mustChangePassword: true,
        lastLoginAt: null,
      },
    });
    expect(typeof body.temporaryPassword).toBe("string");
    expect(JSON.stringify(body).split(temporaryPassword)).toHaveLength(2);
    expect(temporaryPassword).toHaveLength(24);

    const list = await request(runtime.server)
      .get("/api/v1/admin/members")
      .set("Cookie", admin.cookie);
    expect(list.status).toBe(200);
    const listBody = responseBody(list) as { members: unknown[] };
    expect(listBody.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ loginName: "Reader.One", role: "reader" }),
      ]),
    );
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|providerSubject|temporaryPassword/);

    const audit = await runtime.database.$client.query<{ metadata: unknown }>(
      "SELECT metadata FROM audit_logs WHERE action = 'admin.member.created'",
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0]?.metadata)).not.toContain(temporaryPassword);
  });

  it("rejects a case-insensitive normalized login conflict without partial rows", async () => {
    expect((await createMember("Reader.One")).status).toBe(201);

    const conflict = await createMember("READER.ONE", "Duplicate Reader");

    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ error: { code: "LOGIN_NAME_CONFLICT" } });
    const rows = await runtime.database.$client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM auth_identities WHERE provider_subject = 'reader.one'",
    );
    expect(rows.rows[0]?.count).toBe("1");
  });

  it("resets a password, revokes every existing session, and never audits the temporary value", async () => {
    const created = await createMember("reader.one");
    const createdBody = responseBody(created) as CreatedMemberBody;
    const membershipId = createdBody.member.id;
    const firstPassword = createdBody.temporaryPassword;
    const firstLogin = await login(runtime, "reader.one", firstPassword);
    const secondLogin = await login(runtime, "reader.one", firstPassword);
    if (firstLogin.session === undefined || secondLogin.session === undefined) {
      throw new Error("Reader sessions were not created");
    }

    const reset = await request(runtime.server)
      .post(`/api/v1/admin/members/${membershipId}/password/reset`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken);
    const nextPassword = (responseBody(reset) as { temporaryPassword: string }).temporaryPassword;

    expect(reset.status).toBe(201);
    expect(nextPassword).toHaveLength(24);
    expect(nextPassword).not.toBe(firstPassword);
    for (const session of [firstLogin.session, secondLogin.session]) {
      const me = await request(runtime.server).get("/api/v1/me").set("Cookie", session.cookie);
      expect(me.body).toMatchObject({ error: { code: "AUTH_SESSION_EXPIRED" } });
    }
    expect((await login(runtime, "reader.one", firstPassword)).response.status).toBe(401);
    expect((await login(runtime, "reader.one", nextPassword)).response.body).toMatchObject({
      role: "reader",
      mustChangePassword: true,
    });
    const audit = await runtime.database.$client.query<{ metadata: unknown }>(
      "SELECT metadata FROM audit_logs WHERE action = 'admin.member.password_reset'",
    );
    expect(JSON.stringify(audit.rows)).not.toContain(nextPassword);
  });

  it("disables and restores an account while rejecting its revoked session", async () => {
    const created = await createMember("reader.one");
    const createdBody = responseBody(created) as CreatedMemberBody;
    const membershipId = createdBody.member.id;
    const temporary = createdBody.temporaryPassword;
    const temporaryLogin = await login(runtime, "reader.one", temporary);
    if (temporaryLogin.session === undefined) throw new Error("Reader temporary login failed");
    expect(
      (
        await changePassword(
          runtime,
          temporaryLogin.session,
          temporary,
          "Reader-Permanent-Password-1",
        )
      ).status,
    ).toBe(204);
    const activeLogin = await login(runtime, "reader.one", "Reader-Permanent-Password-1");
    if (activeLogin.session === undefined) throw new Error("Reader permanent login failed");

    expect((await changeStatus(admin, membershipId, "disabled")).status).toBe(200);
    const stale = await request(runtime.server)
      .get("/api/v1/me")
      .set("Cookie", activeLogin.session.cookie);
    expect(stale.body).toMatchObject({ error: { code: "AUTH_SESSION_EXPIRED" } });
    expect(
      (await login(runtime, "reader.one", "Reader-Permanent-Password-1")).response.status,
    ).toBe(401);

    expect((await changeStatus(admin, membershipId, "active")).status).toBe(200);
    expect(
      (await login(runtime, "reader.one", "Reader-Permanent-Password-1")).response.status,
    ).toBe(201);
  });

  it("explicitly revokes all member sessions and writes an audit event", async () => {
    const created = await createMember("reader.one");
    const createdBody = responseBody(created) as CreatedMemberBody;
    const membershipId = createdBody.member.id;
    const temporary = createdBody.temporaryPassword;
    const readerLogin = await login(runtime, "reader.one", temporary);
    if (readerLogin.session === undefined) throw new Error("Reader login failed");

    const revoked = await request(runtime.server)
      .post(`/api/v1/admin/members/${membershipId}/sessions/revoke`)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrfToken);

    expect(revoked.status).toBe(204);
    const stale = await request(runtime.server)
      .get("/api/v1/me")
      .set("Cookie", readerLogin.session.cookie);
    expect(stale.body).toMatchObject({ error: { code: "AUTH_SESSION_EXPIRED" } });
    const audit = await runtime.database.$client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_logs WHERE action = 'admin.member.sessions_revoked'",
    );
    expect(audit.rows[0]?.count).toBe("1");
  });

  it("protects the last active Admin under concurrent disable requests", async () => {
    const second = await createMember("admin.two", "Second Admin");
    const secondBody = responseBody(second) as CreatedMemberBody;
    const secondMembershipId = secondBody.member.id;
    const secondTemporary = secondBody.temporaryPassword;
    await runtime.database.$client.query(
      "UPDATE workspace_memberships SET role = 'admin' WHERE id = $1",
      [secondMembershipId],
    );
    const temporaryLogin = await login(runtime, "admin.two", secondTemporary);
    if (temporaryLogin.session === undefined) throw new Error("Second Admin login failed");
    expect(
      (
        await changePassword(
          runtime,
          temporaryLogin.session,
          secondTemporary,
          "Second-Admin-Permanent-1",
        )
      ).status,
    ).toBe(204);
    const secondAdminLogin = await login(runtime, "admin.two", "Second-Admin-Permanent-1");
    if (secondAdminLogin.session === undefined) throw new Error("Second Admin relogin failed");
    const firstMembership = await runtime.database.$client.query<{ id: string }>(
      `SELECT wm.id FROM workspace_memberships wm
       JOIN auth_identities ai ON ai.user_id = wm.user_id
       WHERE ai.provider_subject = 'admin.one'`,
    );
    const firstMembershipId = firstMembership.rows[0]?.id;
    if (firstMembershipId === undefined) throw new Error("First Admin membership missing");

    const [disableSecond, disableFirst] = await Promise.all([
      changeStatus(admin, secondMembershipId, "disabled"),
      changeStatus(secondAdminLogin.session, firstMembershipId, "disabled"),
    ]);

    expect([disableSecond.status, disableFirst.status].sort()).toEqual([200, 409]);
    const activeAdmins = await runtime.database.$client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM workspace_memberships wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.role = 'admin' AND wm.status = 'active' AND u.account_status = 'active'`,
    );
    expect(activeAdmins.rows[0]?.count).toBe("1");
  });

  it("rolls back account disable when Redis revocation fails", async () => {
    const created = await createMember("reader.one");
    const createdBody = responseBody(created) as CreatedMemberBody;
    const membershipId = createdBody.member.id;
    const userId = createdBody.member.userId;
    await runtime.redis.set(`smm:auth:user:${userId}`, "wrong-redis-type");

    const response = await changeStatus(admin, membershipId, "disabled");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ error: { code: "DEPENDENCY_UNAVAILABLE" } });
    const account = await runtime.database.$client.query<{ account_status: string }>(
      "SELECT account_status FROM users WHERE id = $1",
      [userId],
    );
    expect(account.rows[0]?.account_status).toBe("active");
    const audit = await runtime.database.$client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_logs WHERE action = 'admin.member.disabled'",
    );
    expect(audit.rows[0]?.count).toBe("0");
    await runtime.redis.del(`smm:auth:user:${userId}`);
  });
});
