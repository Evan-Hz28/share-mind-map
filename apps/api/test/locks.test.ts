import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireLockLua,
  forceReleaseLockLua,
  heartbeatLockLua,
  recoverLockLua,
  releaseLockLua,
} from "../src/locks/lock.lua.js";
import { LockStore, type LockRedisClient } from "../src/locks/lock.store.js";

type LockRecord = Record<string, string>;

function argument(args: string[], index: number): string {
  const value = args[index];
  if (value === undefined) throw new Error(`Missing fake Redis argument ${String(index)}`);
  return value;
}

class FakeRedis implements LockRedisClient {
  public readonly records = new Map<string, LockRecord>();
  private readonly expirations = new Map<string, number>();

  public async eval(
    script: string,
    _keys: number,
    key: string,
    ...args: string[]
  ): Promise<unknown> {
    await Promise.resolve();
    const record = this.records.get(key);
    if (script === acquireLockLua) {
      if (record?.active === "1") return [0, record.generation, 0];
      const generation = String((Number(record?.generation ?? "0") || 0) + 1);
      this.records.set(key, {
        documentId: argument(args, 0),
        userId: argument(args, 1),
        platformSessionId: argument(args, 2),
        browserEditSessionId: argument(args, 3),
        tokenDigest: argument(args, 4),
        generation,
        heartbeatAt: argument(args, 5),
        active: "1",
      });
      this.expirations.set(key, Number(args[6]));
      return [1, generation, Number(args[6])];
    }
    if (script === heartbeatLockLua) {
      if (
        record?.active !== "1" ||
        record.userId !== args[0] ||
        record.platformSessionId !== args[1] ||
        record.browserEditSessionId !== args[2] ||
        record.tokenDigest !== args[3] ||
        record.generation !== args[4]
      )
        return [0, record?.generation ?? "0"];
      record.heartbeatAt = argument(args, 5);
      this.expirations.set(key, Number(args[6]));
      return [1, record.generation, Number(args[6])];
    }
    if (script === recoverLockLua) {
      if (
        record?.active !== "1" ||
        record.userId !== args[0] ||
        record.platformSessionId !== args[1] ||
        record.browserEditSessionId !== args[2]
      )
        return [0, record?.generation ?? "0", 0];
      record.tokenDigest = argument(args, 3);
      record.heartbeatAt = argument(args, 4);
      this.expirations.set(key, Number(args[5]));
      return [1, record.generation, Number(args[5])];
    }
    if (script === releaseLockLua) {
      if (record === undefined) return [1, "0"];
      if (record.active !== "1") return [1, record.generation];
      if (
        record.userId !== args[0] ||
        record.platformSessionId !== args[1] ||
        record.browserEditSessionId !== args[2] ||
        record.tokenDigest !== args[3] ||
        record.generation !== args[4]
      )
        return [0, record.generation];
      record.active = "0";
      this.expirations.set(key, 60);
      return [1, record.generation];
    }
    if (script === forceReleaseLockLua) {
      if (record?.active !== "1") return [0, record?.generation ?? "0"];
      record.active = "0";
      record.generation = String(Number(record.generation) + 1);
      this.expirations.set(key, 60);
      return [1, record.generation];
    }
    throw new Error("Unexpected lock script");
  }

  public hgetall(key: string): Promise<Record<string, string>> {
    return Promise.resolve(this.records.get(key) ?? {});
  }

  public ttl(key: string): Promise<number> {
    return Promise.resolve(this.expirations.get(key) ?? -2);
  }

  public digest(token: string, secret = "secret"): string {
    return createHmac("sha256", secret).update(token).digest("hex");
  }
}

const input = {
  documentId: "01994d29-f264-73f0-a4bd-f89da18b8a00",
  userId: "01994d29-f264-73f0-a4bd-f89da18b8a01",
  platformSessionId: "platform-session",
  browserEditSessionId: "browser-session",
};

describe("LockStore", () => {
  let redis: FakeRedis;

  afterEach(() => {
    redis = new FakeRedis();
  });

  it("acquires once, rejects a competing session, and stores only a token digest", async () => {
    redis = new FakeRedis();
    const store = new LockStore(redis, {
      keyPrefix: "test",
      ttlSeconds: 900,
      secret: "phase4-test-secret",
      now: () => "2026-09-20T00:00:00.000Z",
    });

    const first = await store.acquire(input);
    const second = await store.acquire({ ...input, browserEditSessionId: "other-browser" });

    expect(first.status).toBe("acquired");
    expect(second).toMatchObject({ status: "occupied", generation: 1 });
    const record = redis.records.get("test:lock:document:" + input.documentId);
    expect(record?.tokenDigest).toBe(redis.digest(first.token, "phase4-test-secret"));
    expect(JSON.stringify(record)).not.toContain(first.token);
    expect(first.generation).toBe(1);
    expect(first.ttlSeconds).toBe(900);
  });

  it("allows only the owner generation to heartbeat and release", async () => {
    redis = new FakeRedis();
    const store = new LockStore(redis, { ttlSeconds: 900, secret: "secret" });
    const acquired = await store.acquire(input);

    await expect(
      store.heartbeat(
        { ...input, browserEditSessionId: "other" },
        acquired.token,
        acquired.generation,
      ),
    ).resolves.toMatchObject({ status: "lost" });
    await expect(
      store.heartbeat(input, acquired.token, acquired.generation),
    ).resolves.toMatchObject({
      status: "renewed",
    });
    await expect(
      store.release({ ...input, userId: "other" }, acquired.token, acquired.generation),
    ).resolves.toBe(false);
    await expect(store.release(input, acquired.token, acquired.generation)).resolves.toBe(true);
    await expect(store.release(input, acquired.token, acquired.generation)).resolves.toBe(true);
  });

  it("recovers only the same browser edit session and invalidates its old token", async () => {
    redis = new FakeRedis();
    const store = new LockStore(redis, { ttlSeconds: 900, secret: "secret" });
    const acquired = await store.acquire(input);

    await expect(
      store.recover({ ...input, browserEditSessionId: "other-browser" }),
    ).resolves.toMatchObject({ status: "lost", generation: acquired.generation });

    const recovered = await store.recover(input);
    expect(recovered).toMatchObject({
      status: "recovered",
      generation: acquired.generation,
      ttlSeconds: 900,
    });
    if (recovered.status !== "recovered") throw new Error("Expected lock recovery");
    expect(recovered.token).not.toBe(acquired.token);
    await expect(
      store.heartbeat(input, acquired.token, acquired.generation),
    ).resolves.toMatchObject({ status: "lost" });
    await expect(
      store.heartbeat(input, recovered.token, recovered.generation),
    ).resolves.toMatchObject({ status: "renewed" });
  });

  it("increments generation on force release and hides the digest from inspection", async () => {
    redis = new FakeRedis();
    const store = new LockStore(redis, { ttlSeconds: 900, secret: "secret" });
    const acquired = await store.acquire(input);

    await expect(store.forceRelease(input.documentId)).resolves.toMatchObject({
      status: "released",
      generation: 2,
    });
    await expect(
      store.heartbeat(input, acquired.token, acquired.generation),
    ).resolves.toMatchObject({
      status: "lost",
    });
    const inspected = await store.inspect(input.documentId);
    expect(inspected).not.toHaveProperty("tokenDigest");
    expect(inspected).toMatchObject({ occupied: false, generation: 2 });
  });
});
