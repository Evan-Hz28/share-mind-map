import { createDatabase, type Database } from "@share-mind-map/database";
import { Global, Inject, Module } from "@nestjs/common";
import type { DynamicModule, OnApplicationShutdown } from "@nestjs/common";
import Redis from "ioredis";

import { PasswordChangeGuard } from "../common/guards/password-change.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { SESSION_LOOKUP, SessionGuard } from "../common/guards/session.guard.js";
import { AdminOperationsService } from "../operations/admin-operations.service.js";
import type { AppConfig } from "../platform/config/app-config.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { AUTH_DATABASE, AUTH_REDIS } from "./auth.tokens.js";
import { CsrfService } from "./csrf/csrf.service.js";
import { PasswordService } from "./password/password.service.js";
import { LoginRateLimitService } from "./rate-limit/login-rate-limit.service.js";
import { SessionStore } from "./session/session.store.js";

class AuthInfrastructureLifecycle implements OnApplicationShutdown {
  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
  ) {}

  public async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.database.$client.end(), this.redis.quit()]);
  }
}

@Global()
@Module({})
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {
  public static register(config: AppConfig): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        { provide: AUTH_DATABASE, useFactory: () => createDatabase(config.databaseUrl) },
        {
          provide: AUTH_REDIS,
          useFactory: () =>
            new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 }),
        },
        { provide: PasswordService, useFactory: () => new PasswordService(config) },
        CsrfService,
        {
          provide: SessionStore,
          useFactory: (redis: Redis, csrf: CsrfService) =>
            new SessionStore(redis, csrf, { ttlSeconds: config.sessionTtlSeconds }),
          inject: [AUTH_REDIS, CsrfService],
        },
        { provide: SESSION_LOOKUP, useExisting: SessionStore },
        {
          provide: LoginRateLimitService,
          useFactory: (redis: Redis) => new LoginRateLimitService(redis, config.sessionSecret),
          inject: [AUTH_REDIS],
        },
        AuthService,
        AdminOperationsService,
        SessionGuard,
        PasswordChangeGuard,
        RolesGuard,
        AuthInfrastructureLifecycle,
      ],
      exports: [
        AUTH_DATABASE,
        AUTH_REDIS,
        PasswordService,
        CsrfService,
        SessionStore,
        SESSION_LOOKUP,
        LoginRateLimitService,
        AuthService,
        AdminOperationsService,
        SessionGuard,
        PasswordChangeGuard,
        RolesGuard,
      ],
    };
  }
}
