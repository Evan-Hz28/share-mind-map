import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SessionRole } from "../src/auth/session/session.types.js";
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

async function provision(role: "reader" | "editor"): Promise<{
  membershipId: string;
  session: AuthenticatedSession;
}> {
  const created = await request(runtime.server)
    .post("/api/v1/admin/members")
    .set("Cookie", admin.cookie)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({ loginName: `${role}.one`, displayName: `${role} One` });
  const body = responseBody(created) as {
    member: { id: string };
    temporaryPassword: string;
  };
  const membershipId = body.member.id;
  const temporaryPassword = body.temporaryPassword;
  if (role === "editor") {
    await runtime.database.$client.query(
      "UPDATE workspace_memberships SET role = 'editor' WHERE id = $1",
      [membershipId],
    );
  }
  const temporaryLogin = await login(runtime, `${role}.one`, temporaryPassword);
  if (temporaryLogin.session === undefined) throw new Error(`${role} temporary login failed`);
  const permanentPassword = `${role}-Permanent-Password-1`;
  const changed = await changePassword(
    runtime,
    temporaryLogin.session,
    temporaryPassword,
    permanentPassword,
  );
  if (changed.status !== 204) throw new Error(`${role} password change failed`);
  const permanentLogin = await login(runtime, `${role}.one`, permanentPassword);
  if (permanentLogin.session === undefined) throw new Error(`${role} permanent login failed`);
  return { membershipId, session: permanentLogin.session };
}

async function exerciseAdminRoutes(session: AuthenticatedSession, targetId: string) {
  return [
    await request(runtime.server).get("/api/v1/admin/members").set("Cookie", session.cookie),
    await request(runtime.server)
      .post("/api/v1/admin/members")
      .set("Cookie", session.cookie)
      .set("X-CSRF-Token", session.csrfToken)
      .send({ loginName: "spoofed.admin", displayName: "Spoofed Admin", role: "admin" }),
    await request(runtime.server)
      .post(`/api/v1/admin/members/${targetId}/password/reset`)
      .set("Cookie", session.cookie)
      .set("X-CSRF-Token", session.csrfToken),
    await request(runtime.server)
      .patch(`/api/v1/admin/members/${targetId}/account-status`)
      .set("Cookie", session.cookie)
      .set("X-CSRF-Token", session.csrfToken)
      .send({ status: "disabled", role: "admin" }),
    await request(runtime.server)
      .post(`/api/v1/admin/members/${targetId}/sessions/revoke`)
      .set("Cookie", session.cookie)
      .set("X-CSRF-Token", session.csrfToken),
  ];
}

describe("administrator route authorization", () => {
  it.each(["reader", "editor"] as const)(
    "denies every administrator member operation to %s",
    async (role) => {
      const actor = await provision(role);

      const responses = await exerciseAdminRoutes(actor.session, actor.membershipId);

      expect(responses.map(({ status }) => status)).toEqual([403, 403, 403, 403, 403]);
      for (const response of responses) {
        expect(response.body).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
      }
      const memberships = await runtime.database.$client.query<{ role: SessionRole }>(
        "SELECT role FROM workspace_memberships",
      );
      expect(memberships.rows.map(({ role: storedRole }) => storedRole).sort()).toEqual(
        ["admin", role].sort(),
      );
    },
  );
});
