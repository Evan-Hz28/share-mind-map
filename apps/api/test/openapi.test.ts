import { describe, expect, it } from "vitest";

import { createApp } from "../src/main.js";
import { buildOpenApiDocument } from "../src/openapi.js";
import type { HealthChecks } from "../src/health/health.service.js";
import { MAIL_PROVIDER } from "../src/mail/mail-provider.js";
import { SmtpMailProvider } from "../src/mail/smtp-mail.provider.js";
import type { AppConfig } from "../src/platform/config/app-config.js";

const config: AppConfig = {
  environment: "test",
  host: "127.0.0.1",
  port: 3000,
  apiPublicUrl: new URL("http://localhost:3000"),
  webOrigin: new URL("http://localhost:5173"),
  databaseUrl: "postgresql://test:test@localhost:5432/test",
  redisUrl: "redis://localhost:6379",
  minio: {
    endpoint: new URL("http://localhost:9000"),
    accessKey: "test",
    secretKey: "test-secret",
    bucket: "share-mind-map",
    useSsl: false,
  },
  smtp: {
    host: "localhost",
    port: 1025,
    secure: false,
    from: "share-mind-map@localhost",
  },
  sessionSecret: "test-session-secret",
  sessionTtlSeconds: 86_400,
  documentLockTtlSeconds: 900,
  cookie: { secure: false, sameSite: "lax" },
  argon2: { memoryKiB: 8_192, iterations: 1, parallelism: 1 },
  trustProxyCount: 1,
  queuePrefix: "smm",
  logLevel: "silent",
};

const checks: HealthChecks = {
  postgres: () => Promise.resolve(),
  redis: () => Promise.resolve(),
  minio: () => Promise.resolve(),
  smtp: () => Promise.resolve(),
};

describe("OpenAPI metadata", () => {
  it("is deterministic and documents platform headers, errors, and health endpoints", async () => {
    const app = await createApp({ config, healthChecks: checks });
    try {
      const first = buildOpenApiDocument(app);
      const second = buildOpenApiDocument(app);

      expect(second).toEqual(first);
      expect(first.servers).toEqual([{ url: "/api/v1" }]);
      expect(first.components?.securitySchemes).toMatchObject({
        sessionCookie: { type: "apiKey", in: "cookie", name: "smm_session" },
        csrfToken: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
        requestId: { type: "apiKey", in: "header", name: "X-Request-ID" },
      });
      expect(first.components?.schemas?.ApiErrorEnvelope).toBeDefined();
      expect(first.paths).toHaveProperty("/health/live");
      expect(first.paths).toHaveProperty("/health/ready");
      expect(app.get(MAIL_PROVIDER)).toBeInstanceOf(SmtpMailProvider);
      const expressApp = app.getHttpAdapter().getInstance() as {
        get(setting: string): unknown;
      };
      expect(expressApp.get("trust proxy")).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("requires session cookie and CSRF together for authenticated mutations", async () => {
    const app = await createApp({ config, healthChecks: checks });
    try {
      const document = buildOpenApiDocument(app);
      const authenticatedMutations = [
        document.paths["/api/v1/auth/password"]?.put,
        document.paths["/api/v1/auth/logout"]?.post,
        document.paths["/api/v1/admin/members"]?.post,
        document.paths["/api/v1/admin/members/{id}/password/reset"]?.post,
        document.paths["/api/v1/admin/members/{id}/account-status"]?.patch,
        document.paths["/api/v1/admin/members/{id}/sessions/revoke"]?.post,
        document.paths["/api/v1/workspaces/{workspaceId}/documents/{documentId}/snapshots"]?.post,
        document.paths["/api/v1/workspaces/{workspaceId}/documents/{documentId}/draft-export"]
          ?.post,
      ];

      for (const operation of authenticatedMutations) {
        expect(operation?.security).toEqual([{ sessionCookie: [], csrfToken: [] }]);
      }
      expect(document.paths["/api/v1/auth/csrf"]?.get?.security).toEqual([{ sessionCookie: [] }]);
      expect(document.paths["/api/v1/me"]?.get?.security).toEqual([{ sessionCookie: [] }]);
      expect(document.paths["/api/v1/admin/members"]?.get?.security).toEqual([
        { sessionCookie: [] },
      ]);
    } finally {
      await app.close();
    }
  });
});
