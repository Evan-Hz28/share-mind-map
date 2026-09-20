import { createHash, randomUUID } from "node:crypto";

import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { CsrfService } from "../src/auth/csrf/csrf.service.js";
import { SessionStore } from "../src/auth/session/session.store.js";
import type { SessionPrincipal } from "../src/auth/session/session.types.js";

const redis = new Redis(process.env.TEST_REDIS_URL ?? "redis://default:123456@localhost:16379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
const keyPrefix = `smm:test:session:${randomUUID()}`;
const csrf = new CsrfService();
const sessions = new SessionStore(redis, csrf, { keyPrefix, ttlSeconds: 86_400 });
const principal: SessionPrincipal = {
  userId: "01994d29-f264-73f0-a4bd-f89da18b8a00",
  workspaceId: "01994d29-f264-73f0-a4bd-f89da18b8a01",
  role: "reader",
  mustChangePassword: true,
};

async function deleteTestKeys(): Promise<void> {
  const keys = await redis.keys(`${keyPrefix}:*`);
  if (keys.length > 0) await redis.del(...keys);
}

describe("SessionStore with real Redis", () => {
  beforeEach(async () => {
    if (redis.status === "wait") await redis.connect();
    await deleteTestKeys();
  });

  afterAll(async () => {
    await deleteTestKeys();
    await redis.quit();
  });

  it("creates an opaque session with hashed addressing, CSRF binding, and a 24-hour TTL", async () => {
    const created = await sessions.create(principal);
    const tokenDigest = createHash("sha256").update(created.token).digest("hex");
    const sessionKey = `${keyPrefix}:session:${tokenDigest}`;
    const keys = await redis.keys(`${keyPrefix}:*`);
    const stored = await sessions.get(created.token);

    expect(Buffer.from(created.token, "base64url")).toHaveLength(32);
    expect(Buffer.from(created.csrfToken, "base64url")).toHaveLength(32);
    expect(keys).toContain(sessionKey);
    expect(JSON.stringify(keys)).not.toContain(created.token);
    expect(JSON.stringify(keys)).not.toContain(created.csrfToken);
    expect(stored).toEqual({ ...principal, csrfDigest: csrf.digest(created.csrfToken) });
    expect(await redis.ttl(sessionKey)).toBeGreaterThanOrEqual(86_390);
    expect(await redis.ttl(sessionKey)).toBeLessThanOrEqual(86_400);
    expect(await redis.ttl(`${keyPrefix}:user:${principal.userId}`)).toBeGreaterThanOrEqual(86_390);
    expect(await redis.get(sessionKey)).not.toContain(created.token);
    expect(await redis.get(sessionKey)).not.toContain(created.csrfToken);
  });

  it("does not refresh session TTL or role while reading", async () => {
    const created = await sessions.create(principal);
    const sessionKey = `${keyPrefix}:session:${createHash("sha256").update(created.token).digest("hex")}`;
    await redis.pexpire(sessionKey, 5_000);

    expect(await sessions.get(created.token)).toMatchObject({ role: "reader" });
    expect(await redis.pttl(sessionKey)).toBeGreaterThan(0);
    expect(await redis.pttl(sessionKey)).toBeLessThanOrEqual(5_000);
  });

  it("rotates the session-bound CSRF digest without extending the session TTL", async () => {
    const created = await sessions.create(principal);
    const sessionKey = `${keyPrefix}:session:${createHash("sha256").update(created.token).digest("hex")}`;
    await redis.pexpire(sessionKey, 5_000);

    const rotated = await sessions.rotateCsrf(created.token);
    const stored = await sessions.get(created.token);

    expect(rotated).not.toBeNull();
    expect(rotated).not.toBe(created.csrfToken);
    expect(stored?.csrfDigest).toBe(csrf.digest(rotated as string));
    expect(csrf.verify(created.csrfToken, stored?.csrfDigest ?? "")).toBe(false);
    expect(await redis.pttl(sessionKey)).toBeGreaterThan(0);
    expect(await redis.pttl(sessionKey)).toBeLessThanOrEqual(5_000);
  });

  it("revokes one session without affecting another session for the user", async () => {
    const first = await sessions.create(principal);
    const second = await sessions.create(principal);

    await sessions.revoke(first.token);

    await expect(sessions.get(first.token)).resolves.toBeNull();
    await expect(sessions.get(second.token)).resolves.toMatchObject(principal);
    expect(await redis.scard(`${keyPrefix}:user:${principal.userId}`)).toBe(1);
  });

  it("atomically indexes concurrent creations and revokes every session for a user", async () => {
    const created = await Promise.all(
      Array.from({ length: 12 }, async () => sessions.create(principal)),
    );

    await expect(redis.scard(`${keyPrefix}:user:${principal.userId}`)).resolves.toBe(12);
    await expect(sessions.revokeAll(principal.userId)).resolves.toBe(12);

    await expect(
      Promise.all(created.map(async ({ token }) => sessions.get(token))),
    ).resolves.toEqual(Array.from({ length: 12 }, () => null));
    await expect(redis.exists(`${keyPrefix}:user:${principal.userId}`)).resolves.toBe(0);
  });

  it("treats an expired Redis record as no session", async () => {
    const created = await sessions.create(principal);
    const sessionKey = `${keyPrefix}:session:${createHash("sha256").update(created.token).digest("hex")}`;
    await redis.pexpire(sessionKey, 0);

    await expect(redis.exists(sessionKey)).resolves.toBe(0);
    await expect(sessions.get(created.token)).resolves.toBeNull();
  });
});
