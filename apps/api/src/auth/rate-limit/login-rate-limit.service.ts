import { createHmac } from "node:crypto";

import type Redis from "ioredis";

import { ApiError } from "../../platform/errors/api-error.js";
import { normalizeLoginName } from "../password/password-policy.js";
import { assertLoginAllowedLua, recordLoginFailureLua } from "./login-rate-limit.lua.js";

const accountLimit = 5;
const sourceLimit = 50;
const windowSeconds = 15 * 60;

export interface LoginRateLimitOptions {
  keyPrefix?: string;
}

export class LoginRateLimitService {
  private readonly derivedSecret: Buffer;
  private readonly keyPrefix: string;

  public constructor(
    private readonly redis: Redis,
    serverSecret: string,
    options: LoginRateLimitOptions = {},
  ) {
    this.derivedSecret = createHmac("sha256", serverSecret)
      .update("share-mind-map/login-rate-limit/v1")
      .digest();
    this.keyPrefix = options.keyPrefix ?? "smm:login-limit";
  }

  public async recordFailure(loginName: string, sourceAddress: string): Promise<void> {
    await this.redis.eval(
      recordLoginFailureLua,
      2,
      this.accountKey(loginName),
      this.sourceKey(sourceAddress),
      windowSeconds,
    );
  }

  public async recordSuccess(loginName: string): Promise<void> {
    await this.redis.del(this.accountKey(loginName));
  }

  public async assertAllowed(loginName: string, sourceAddress: string): Promise<void> {
    const result = (await this.redis.eval(
      assertLoginAllowedLua,
      2,
      this.accountKey(loginName),
      this.sourceKey(sourceAddress),
      accountLimit,
      sourceLimit,
    )) as [number | string, number | string];
    if (Number(result[0]) === 1) {
      throw new ApiError("RATE_LIMITED", { retryAfterSeconds: Number(result[1]) });
    }
  }

  private accountKey(loginName: string): string {
    return `${this.keyPrefix}:account:${this.digest("account", normalizeLoginName(loginName))}`;
  }

  private sourceKey(sourceAddress: string): string {
    return `${this.keyPrefix}:source:${this.digest("source", sourceAddress)}`;
  }

  private digest(kind: "account" | "source", value: string): string {
    return createHmac("sha256", this.derivedSecret)
      .update(kind)
      .update("\0")
      .update(value, "utf8")
      .digest("hex");
  }
}
