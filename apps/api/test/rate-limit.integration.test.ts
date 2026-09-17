import { randomUUID } from "node:crypto";

import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { LoginRateLimitService } from "../src/auth/rate-limit/login-rate-limit.service.js";
import { ApiError } from "../src/platform/errors/api-error.js";

const redis = new Redis("redis://default:123456@localhost:16379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
const keyPrefix = `smm:test:login-limit:${randomUUID()}`;
const secret = "integration-only-session-secret-for-rate-limit";
const limits = new LoginRateLimitService(redis, secret, { keyPrefix });

async function deleteTestKeys(): Promise<void> {
  const keys = await redis.keys(`${keyPrefix}:*`);
  if (keys.length > 0) await redis.del(...keys);
}

describe("LoginRateLimitService with real Redis", () => {
  beforeEach(async () => {
    if (redis.status === "wait") await redis.connect();
    await deleteTestKeys();
  });

  afterAll(async () => {
    await deleteTestKeys();
    await redis.quit();
  });

  it("blocks a normalized account after five consecutive failures for 15 minutes", async () => {
    await Promise.all(
      Array.from({ length: 4 }, async (_, attempt) =>
        limits.recordFailure("Reader.One", `198.51.100.${String(attempt)}`),
      ),
    );
    await expect(limits.assertAllowed("reader.one", "198.51.100.99")).resolves.toBeUndefined();

    await limits.recordFailure("READER.ONE", "198.51.100.4");

    let rateLimitError: unknown;
    try {
      await limits.assertAllowed("reader.one", "198.51.100.99");
    } catch (error) {
      rateLimitError = error;
    }
    expect(rateLimitError).toBeInstanceOf(ApiError);
    if (!(rateLimitError instanceof ApiError)) throw new Error("Expected a rate-limit error");
    expect(rateLimitError.code).toBe("RATE_LIMITED");
    expect(typeof rateLimitError.details.retryAfterSeconds).toBe("number");
    const accountKey = (await redis.keys(`${keyPrefix}:account:*`))[0];
    expect(accountKey).toBeDefined();
    await expect(redis.hget(accountKey as string, "count")).resolves.toBe("5");
    const ttl = await redis.ttl(accountKey as string);
    expect(ttl).toBeGreaterThanOrEqual(890);
    expect(ttl).toBeLessThanOrEqual(900);
  });

  it("counts 50 concurrent source failures atomically across independent accounts", async () => {
    await Promise.all(
      Array.from({ length: 50 }, async (_, index) =>
        limits.recordFailure(`reader.${String(index).padStart(2, "0")}`, "203.0.113.20"),
      ),
    );

    await expect(limits.assertAllowed("another.reader", "203.0.113.20")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    const sourceKey = (await redis.keys(`${keyPrefix}:source:*`))[0];
    expect(sourceKey).toBeDefined();
    await expect(redis.hget(sourceKey as string, "count")).resolves.toBe("50");
  });

  it("clears only the account window on success and leaves the source window intact", async () => {
    await limits.recordFailure("reader.one", "203.0.113.30");
    await limits.recordSuccess("READER.ONE");

    await expect(limits.assertAllowed("reader.one", "203.0.113.30")).resolves.toBeUndefined();
    expect(await redis.keys(`${keyPrefix}:account:*`)).toHaveLength(0);
    const sourceKeys = await redis.keys(`${keyPrefix}:source:*`);
    expect(sourceKeys).toHaveLength(1);
    await expect(redis.hget(sourceKeys[0] as string, "count")).resolves.toBe("1");
  });

  it("uses only HMAC digests in keys, never raw login names, sources, or the secret", async () => {
    const loginName = "Sensitive.Reader";
    const source = "192.0.2.44";

    await limits.recordFailure(loginName, source);
    const serializedKeys = JSON.stringify(await redis.keys(`${keyPrefix}:*`));

    expect(serializedKeys).not.toContain(loginName);
    expect(serializedKeys).not.toContain(loginName.toLowerCase());
    expect(serializedKeys).not.toContain(source);
    expect(serializedKeys).not.toContain(secret);
    expect(await redis.keys(`${keyPrefix}:account:*`)).toHaveLength(1);
    expect(await redis.keys(`${keyPrefix}:source:*`)).toHaveLength(1);
  });
});
