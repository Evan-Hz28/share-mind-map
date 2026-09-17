import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type AuthTestRuntime,
  changePassword,
  initializeDefaultAdmin,
  login,
  resetAuthTestRuntime,
  responseBody,
  startAuthTestRuntime,
  stopAuthTestRuntime,
} from "./helpers/auth-fixtures.js";

let runtime: AuthTestRuntime;
let temporaryPassword: string;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

beforeAll(async () => {
  runtime = await startAuthTestRuntime();
}, 120_000);

beforeEach(async () => {
  await resetAuthTestRuntime(runtime);
  ({ password: temporaryPassword } = await initializeDefaultAdmin(runtime));
});

afterAll(async () => {
  await stopAuthTestRuntime(runtime);
});

describe("phase 1 authentication HTTP", () => {
  it.each(["missing", "wrong-password", "disabled"] as const)(
    "returns the same public login failure for %s account",
    async (scenario) => {
      let loginName = "Admin.One";
      let password = "Wrong-Password-123";
      if (scenario === "missing") loginName = "Missing.User";
      if (scenario === "disabled") {
        password = temporaryPassword;
        await runtime.database.$client.query("UPDATE users SET account_status = 'disabled'");
      }

      const { response } = await login(runtime, loginName, password);

      expect(response.status).toBe(401);
      expect((responseBody(response) as ErrorBody).error).toMatchObject({
        code: "AUTH_INVALID_CREDENTIALS",
        message: "账号或密码错误。",
        details: {},
      });
    },
  );

  it("sets the secure cookie contract and returns only safe session fields", async () => {
    const { response, session } = await login(runtime, "ADMIN.ONE", temporaryPassword);

    expect(response.status).toBe(201);
    expect(session).toBeDefined();
    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("smm_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=86400");
    expect(setCookie).not.toContain("Secure");
    const body = responseBody(response) as Record<string, unknown>;
    expect(body).toMatchObject({
      user: { displayName: "First Admin" },
      organization: { name: "Test Organization" },
      defaultWorkspace: { name: "Default Workspace" },
      role: "admin",
      mustChangePassword: true,
    });
    expect(typeof body.csrfToken).toBe("string");
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|sessionToken|providerSubject/);

    const audit = await runtime.database.$client.query<{
      action: string;
      actor_session_id: string | null;
      metadata: unknown;
    }>(
      "SELECT action, actor_session_id, metadata FROM audit_logs WHERE action = 'auth.login.succeeded'",
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.actor_session_id).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(audit.rows[0]?.metadata)).not.toContain(temporaryPassword);
    expect(JSON.stringify(audit.rows[0])).not.toContain(session?.cookie ?? "missing-cookie");
  });

  it("audits failed login without raw login names, passwords, or source addresses", async () => {
    const attemptedLogin = "Missing.User";
    const attemptedPassword = "Wrong-Password-123";

    await login(runtime, attemptedLogin, attemptedPassword);
    const audit = await runtime.database.$client.query<{ metadata: unknown }>(
      "SELECT metadata FROM audit_logs WHERE action = 'auth.login.failed'",
    );
    const serialized = JSON.stringify(audit.rows);

    expect(audit.rows).toHaveLength(1);
    expect(serialized).not.toContain(attemptedLogin);
    expect(serialized).not.toContain(attemptedLogin.toLowerCase());
    expect(serialized).not.toContain(attemptedPassword);
    expect(serialized).not.toMatch(/127\.0\.0\.1|::1/);
  });

  it("enforces five account failures and returns safe retry seconds", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { response } = await login(runtime, "Admin.One", "Wrong-Password-123");
      expect(response.status).toBe(401);
    }

    const blocked = await login(runtime, "Admin.One", temporaryPassword);

    expect(blocked.response.status).toBe(429);
    const body = responseBody(blocked.response) as ErrorBody;
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(typeof body.error.details.retryAfterSeconds).toBe("number");
  });

  it("enforces 50 source failures independently across account names", async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const { response } = await login(
        runtime,
        `missing.${String(attempt).padStart(2, "0")}`,
        "Wrong-Password-123",
      );
      expect(response.status).toBe(401);
    }

    const blocked = await login(runtime, "another.missing", "Wrong-Password-123");

    expect(blocked.response.status).toBe(429);
    expect(blocked.response.body).toMatchObject({ error: { code: "RATE_LIMITED" } });
  }, 30_000);

  it("permits only csrf, me, password change, and logout before password change", async () => {
    const firstLogin = await login(runtime, "admin.one", temporaryPassword);
    const secondLogin = await login(runtime, "admin.one", temporaryPassword);
    if (firstLogin.session === undefined || secondLogin.session === undefined) {
      throw new Error("Temporary login did not create both sessions");
    }

    const csrf = await request(runtime.server)
      .get("/api/v1/auth/csrf")
      .set("Cookie", firstLogin.session.cookie);
    const bootstrappedCsrf = (responseBody(csrf) as { csrfToken: string }).csrfToken;
    const bootstrappedSession = { ...firstLogin.session, csrfToken: bootstrappedCsrf };
    const me = await request(runtime.server)
      .get("/api/v1/me")
      .set("Cookie", firstLogin.session.cookie);
    const members = await request(runtime.server)
      .get("/api/v1/admin/members")
      .set("Cookie", firstLogin.session.cookie);
    const wrongCurrent = await changePassword(
      runtime,
      bootstrappedSession,
      "Wrong-Current-Password",
      "Permanent-Admin-Password-1",
    );

    expect(csrf.status).toBe(200);
    expect(typeof (responseBody(csrf) as { csrfToken: unknown }).csrfToken).toBe("string");
    expect(bootstrappedCsrf).not.toBe(firstLogin.session.csrfToken);
    expect(me.body).toMatchObject({ role: "admin", mustChangePassword: true });
    expect(members.body).toMatchObject({ error: { code: "AUTH_PASSWORD_CHANGE_REQUIRED" } });
    expect(wrongCurrent.body).toMatchObject({ error: { code: "AUTH_CURRENT_PASSWORD_INVALID" } });

    const changed = await changePassword(
      runtime,
      bootstrappedSession,
      temporaryPassword,
      "Permanent-Admin-Password-1",
    );
    expect(changed.status).toBe(204);
    expect(String(changed.headers["set-cookie"])).toContain("Max-Age=0");

    for (const stale of [firstLogin.session, secondLogin.session]) {
      const response = await request(runtime.server).get("/api/v1/me").set("Cookie", stale.cookie);
      expect(response.body).toMatchObject({ error: { code: "AUTH_SESSION_EXPIRED" } });
    }
    expect((await login(runtime, "admin.one", temporaryPassword)).response.status).toBe(401);
    const relogin = await login(runtime, "admin.one", "Permanent-Admin-Password-1");
    expect(relogin.response.status).toBe(201);
    expect(relogin.response.body).toMatchObject({ mustChangePassword: false });
  });

  it("rejects unsafe requests without the session-bound CSRF value", async () => {
    const loggedIn = await login(runtime, "admin.one", temporaryPassword);
    if (loggedIn.session === undefined) throw new Error("Temporary login failed");

    const missing = await request(runtime.server)
      .put("/api/v1/auth/password")
      .set("Cookie", loggedIn.session.cookie)
      .send({ currentPassword: temporaryPassword, newPassword: "Permanent-Admin-Password-1" });
    const wrong = await request(runtime.server)
      .post("/api/v1/auth/logout")
      .set("Cookie", loggedIn.session.cookie)
      .set("X-CSRF-Token", "wrong");

    expect(missing.body).toMatchObject({ error: { code: "CSRF_INVALID" } });
    expect(wrong.body).toMatchObject({ error: { code: "CSRF_INVALID" } });
  });

  it("makes logout idempotent and clears the browser cookie", async () => {
    const loggedIn = await login(runtime, "admin.one", temporaryPassword);
    if (loggedIn.session === undefined) throw new Error("Temporary login failed");

    const first = await request(runtime.server)
      .post("/api/v1/auth/logout")
      .set("Cookie", loggedIn.session.cookie)
      .set("X-CSRF-Token", loggedIn.session.csrfToken);
    const second = await request(runtime.server)
      .post("/api/v1/auth/logout")
      .set("Cookie", loggedIn.session.cookie)
      .set("X-CSRF-Token", loggedIn.session.csrfToken);

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(String(first.headers["set-cookie"])).toContain("Max-Age=0");
    expect(String(second.headers["set-cookie"])).toContain("Max-Age=0");
  });

  it("does not expose a registration endpoint", async () => {
    const response = await request(runtime.server)
      .post("/api/v1/auth/register")
      .send({ loginName: "new.user", password: "Not-Allowed-Password-1" });

    expect(response.status).toBe(404);
  });
});
