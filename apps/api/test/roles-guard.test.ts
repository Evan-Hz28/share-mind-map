import "reflect-metadata";

import type { Server } from "node:http";

import { Body, Controller, Get, Module, Post, Put } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CsrfService } from "../src/auth/csrf/csrf.service.js";
import type { SessionRecord, SessionRole } from "../src/auth/session/session.types.js";
import { Roles } from "../src/common/decorators/roles.js";
import { PasswordChangeGuard } from "../src/common/guards/password-change.guard.js";
import { RolesGuard } from "../src/common/guards/roles.guard.js";
import { SessionGuard, type SessionLookup } from "../src/common/guards/session.guard.js";
import { createApp } from "../src/main.js";

const csrf = new CsrfService();
const issuedCsrf = csrf.issue();
const tokenFor = (role: SessionRole): string => `${role}-session-token`;
const sessions = new Map<string, SessionRecord>(
  (["reader", "editor", "admin"] as const).map((role) => [
    tokenFor(role),
    {
      userId: `${role}-user-id`,
      workspaceId: "workspace-id",
      role,
      mustChangePassword: false,
      csrfDigest: issuedCsrf.digest,
    },
  ]),
);
sessions.set("forced-session-token", {
  userId: "forced-user-id",
  workspaceId: "workspace-id",
  role: "admin",
  mustChangePassword: true,
  csrfDigest: issuedCsrf.digest,
});

const sessionLookup: SessionLookup = {
  get: (token) => Promise.resolve(sessions.get(token) ?? null),
};

@Controller()
class GuardMatrixController {
  @Get("reader")
  @Roles("reader")
  public reader(): object {
    return { ok: true };
  }

  @Get("editor")
  @Roles("editor")
  public editor(): object {
    return { ok: true };
  }

  @Get("admin")
  @Roles("admin")
  public admin(): object {
    return { ok: true };
  }

  @Post("admin")
  @Roles("admin")
  public adminFromBody(@Body() body: unknown): unknown {
    return body;
  }

  @Post("reader-action")
  @Roles("reader")
  public readerAction(): object {
    return { ok: true };
  }

  @Get("me")
  public me(): object {
    return { ok: true };
  }

  @Get("auth/csrf")
  public csrfBootstrap(): object {
    return { ok: true };
  }

  @Put("auth/password")
  public changePassword(): object {
    return { ok: true };
  }

  @Post("auth/logout")
  public logout(): object {
    return { ok: true };
  }

  @Get("blocked-forced")
  public blockedForced(): object {
    return { ok: true };
  }
}

@Module({
  controllers: [GuardMatrixController],
  providers: [
    { provide: APP_GUARD, useValue: new SessionGuard(sessionLookup, csrf) },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
// Nest test modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class GuardMatrixModule {}

function asRole(server: Server, role: SessionRole, method: "get" | "post", path: string) {
  const roleRequest = method === "get" ? request(server).get(path) : request(server).post(path);
  return roleRequest.set("Cookie", `smm_session=${tokenFor(role)}`);
}

describe("session, forced-password-change, and role guards", () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let server: Server;

  beforeAll(async () => {
    app = await createApp({ module: GuardMatrixModule });
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ["reader", "/api/v1/reader", 200],
    ["reader", "/api/v1/editor", 403],
    ["reader", "/api/v1/admin", 403],
    ["editor", "/api/v1/reader", 200],
    ["editor", "/api/v1/editor", 200],
    ["editor", "/api/v1/admin", 403],
    ["admin", "/api/v1/reader", 200],
    ["admin", "/api/v1/editor", 200],
    ["admin", "/api/v1/admin", 200],
  ] as const)("allows %s to request %s with status %s", async (role, path, status) => {
    const response = await asRole(server, role, "get", path);

    expect(response.status).toBe(status);
    if (status === 403)
      expect(response.body).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });

  it("never trusts a role supplied by the request body", async () => {
    const response = await asRole(server, "reader", "post", "/api/v1/admin")
      .set("X-CSRF-Token", issuedCsrf.value)
      .send({ role: "admin" });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });

  it("reads only the smm_session cookie and distinguishes missing from expired sessions", async () => {
    const bearer = await request(server)
      .get("/api/v1/reader")
      .set("Authorization", `Bearer ${tokenFor("admin")}`);
    const otherCookie = await request(server)
      .get("/api/v1/reader")
      .set("Cookie", `other=${tokenFor("admin")}`);
    const expired = await request(server)
      .get("/api/v1/reader")
      .set("Cookie", "smm_session=expired-session-token");

    expect(bearer.status).toBe(401);
    expect(bearer.body).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(otherCookie.body).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(expired.body).toMatchObject({ error: { code: "AUTH_SESSION_EXPIRED" } });
  });

  it("requires the session-bound CSRF value for unsafe methods", async () => {
    const missing = await asRole(server, "reader", "post", "/api/v1/reader-action");
    const wrong = await asRole(server, "reader", "post", "/api/v1/reader-action").set(
      "X-CSRF-Token",
      "wrong",
    );
    const valid = await asRole(server, "reader", "post", "/api/v1/reader-action").set(
      "X-CSRF-Token",
      issuedCsrf.value,
    );

    expect(missing.body).toMatchObject({ error: { code: "CSRF_INVALID" } });
    expect(wrong.body).toMatchObject({ error: { code: "CSRF_INVALID" } });
    expect(valid.status).toBe(201);
  });

  it("restricts forced-change sessions to the four exact bootstrap routes", async () => {
    const cookie = "smm_session=forced-session-token";
    const csrfResponse = await request(server).get("/api/v1/auth/csrf").set("Cookie", cookie);
    const meResponse = await request(server).get("/api/v1/me").set("Cookie", cookie);
    const passwordResponse = await request(server)
      .put("/api/v1/auth/password")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", issuedCsrf.value);
    const logoutResponse = await request(server)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", issuedCsrf.value);
    const blocked = await request(server).get("/api/v1/blocked-forced").set("Cookie", cookie);

    expect([
      csrfResponse.status,
      meResponse.status,
      passwordResponse.status,
      logoutResponse.status,
    ]).toEqual([200, 200, 200, 201]);
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ error: { code: "AUTH_PASSWORD_CHANGE_REQUIRED" } });
  });
});
