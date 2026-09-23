import { createHmac, randomBytes } from "node:crypto";

import {
  acquireLockLua,
  forceReleaseLockLua,
  heartbeatLockLua,
  recoverLockLua,
  releaseLockLua,
} from "./lock.lua.js";
import type {
  LockAcquireResult,
  LockForceReleaseResult,
  LockHeartbeatResult,
  LockInspection,
  LockOwner,
  LockRecoverResult,
} from "./lock.types.js";

export interface LockRedisClient {
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  ttl(key: string): Promise<number>;
}

export interface LockStoreOptions {
  keyPrefix?: string;
  ttlSeconds: number;
  secret: string;
  now?: () => string;
}

function resultValues(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Unexpected Redis lock result.");
  return value.map((part) => String(part));
}

export class LockStore {
  private readonly keyPrefix: string;
  private readonly now: () => string;

  public constructor(
    private readonly redis: LockRedisClient,
    private readonly options: LockStoreOptions,
  ) {
    this.keyPrefix = options.keyPrefix ?? "smm";
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async acquire(owner: LockOwner): Promise<LockAcquireResult & { token: string }> {
    const token = randomBytes(32).toString("base64url");
    const [status, generation, ttl] = resultValues(
      await this.redis.eval(
        acquireLockLua,
        1,
        this.key(owner.documentId),
        owner.documentId,
        owner.userId,
        owner.platformSessionId,
        owner.browserEditSessionId,
        this.digest(token),
        this.now(),
        String(this.options.ttlSeconds),
      ),
    );
    if (status !== "1") {
      return { status: "occupied", generation: Number(generation), ttlSeconds: Number(ttl), token };
    }
    return {
      status: "acquired",
      token,
      generation: Number(generation),
      ttlSeconds: Number(ttl),
    };
  }

  public async heartbeat(
    owner: LockOwner,
    token: string,
    generation: number,
  ): Promise<LockHeartbeatResult> {
    const [status, currentGeneration, ttl] = resultValues(
      await this.redis.eval(
        heartbeatLockLua,
        1,
        this.key(owner.documentId),
        owner.userId,
        owner.platformSessionId,
        owner.browserEditSessionId,
        this.digest(token),
        String(generation),
        this.now(),
        String(this.options.ttlSeconds),
      ),
    );
    return status === "1"
      ? { status: "renewed", generation: Number(currentGeneration), ttlSeconds: Number(ttl) }
      : { status: "lost", generation: Number(currentGeneration) };
  }

  public async recover(owner: LockOwner): Promise<LockRecoverResult> {
    const token = randomBytes(32).toString("base64url");
    const [status, generation, ttl] = resultValues(
      await this.redis.eval(
        recoverLockLua,
        1,
        this.key(owner.documentId),
        owner.userId,
        owner.platformSessionId,
        owner.browserEditSessionId,
        this.digest(token),
        this.now(),
        String(this.options.ttlSeconds),
      ),
    );
    return status === "1"
      ? { status: "recovered", token, generation: Number(generation), ttlSeconds: Number(ttl) }
      : { status: "lost", generation: Number(generation), ttlSeconds: Number(ttl) };
  }

  public async release(owner: LockOwner, token: string, generation: number): Promise<boolean> {
    const [status] = resultValues(
      await this.redis.eval(
        releaseLockLua,
        1,
        this.key(owner.documentId),
        owner.userId,
        owner.platformSessionId,
        owner.browserEditSessionId,
        this.digest(token),
        String(generation),
      ),
    );
    return status === "1";
  }

  public async forceRelease(documentId: string): Promise<LockForceReleaseResult> {
    const [status, generation] = resultValues(
      await this.redis.eval(forceReleaseLockLua, 1, this.key(documentId)),
    );
    return status === "1"
      ? { status: "released", generation: Number(generation) }
      : { status: "absent", generation: Number(generation) };
  }

  public async inspect(documentId: string): Promise<LockInspection> {
    const key = this.key(documentId);
    const record = await this.redis.hgetall(key);
    const ttlSeconds = await this.redis.ttl(key);
    return {
      occupied: record.active === "1",
      ...(record.active === "1" && record.userId !== undefined
        ? {
            userId: record.userId,
            platformSessionId: record.platformSessionId,
            browserEditSessionId: record.browserEditSessionId,
            heartbeatAt: record.heartbeatAt,
          }
        : {}),
      generation: Number(record.generation ?? "0"),
      ttlSeconds,
    };
  }

  private digest(token: string): string {
    return createHmac("sha256", this.options.secret).update(token, "utf8").digest("hex");
  }

  private key(documentId: string): string {
    return `${this.keyPrefix}:lock:document:${documentId}`;
  }
}
