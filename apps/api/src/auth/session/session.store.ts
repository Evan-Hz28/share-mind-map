import { createHash, randomBytes } from "node:crypto";

import type Redis from "ioredis";

import { CsrfService } from "../csrf/csrf.service.js";
import {
  createSessionLua,
  revokeAllSessionsLua,
  revokeSessionLua,
  rotateSessionCsrfLua,
} from "./session.lua.js";
import type {
  CreatedSession,
  SessionPrincipal,
  SessionRecord,
  SessionRole,
} from "./session.types.js";

export interface SessionStoreOptions {
  keyPrefix?: string;
  ttlSeconds: number;
}

const roles = new Set<SessionRole>(["reader", "editor", "admin"]);

function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === "string" &&
    typeof record.workspaceId === "string" &&
    typeof record.role === "string" &&
    roles.has(record.role as SessionRole) &&
    typeof record.mustChangePassword === "boolean" &&
    typeof record.csrfDigest === "string" &&
    /^[0-9a-f]{64}$/.test(record.csrfDigest)
  );
}

export class SessionStore {
  private readonly keyPrefix: string;

  public constructor(
    private readonly redis: Redis,
    private readonly csrf: CsrfService,
    options: SessionStoreOptions,
  ) {
    this.keyPrefix = options.keyPrefix ?? "smm:auth";
    this.ttlSeconds = options.ttlSeconds;
  }

  private readonly ttlSeconds: number;

  public async create(principal: SessionPrincipal): Promise<CreatedSession> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(32).toString("base64url");
      const issuedCsrf = this.csrf.issue();
      const record: SessionRecord = { ...principal, csrfDigest: issuedCsrf.digest };
      const created = Number(
        await this.redis.eval(
          createSessionLua,
          2,
          this.sessionKey(token),
          this.userKey(principal.userId),
          JSON.stringify(record),
          this.ttlSeconds,
        ),
      );
      if (created === 1) return { token, csrfToken: issuedCsrf.value };
    }
    throw new Error("Unable to allocate a unique session token");
  }

  public async get(token: string): Promise<SessionRecord | null> {
    const serialized = await this.redis.get(this.sessionKey(token));
    if (serialized === null) return null;
    try {
      const parsed: unknown = JSON.parse(serialized);
      return isSessionRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  public async revoke(token: string): Promise<void> {
    await this.redis.eval(revokeSessionLua, 1, this.sessionKey(token), `${this.keyPrefix}:user:`);
  }

  public async revokeAll(userId: string): Promise<number> {
    return Number(await this.redis.eval(revokeAllSessionsLua, 1, this.userKey(userId)));
  }

  public async rotateCsrf(token: string): Promise<string | null> {
    const issued = this.csrf.issue();
    const rotated = Number(
      await this.redis.eval(rotateSessionCsrfLua, 1, this.sessionKey(token), issued.digest),
    );
    return rotated === 1 ? issued.value : null;
  }

  private sessionKey(token: string): string {
    const digest = createHash("sha256").update(token, "utf8").digest("hex");
    return `${this.keyPrefix}:session:${digest}`;
  }

  private userKey(userId: string): string {
    return `${this.keyPrefix}:user:${userId}`;
  }
}
