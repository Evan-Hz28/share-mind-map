import { describe, expect, it } from "vitest";

import { parseAppConfig } from "../src/platform/config/app-config.js";

function developmentEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ENV: "development",
    API_HOST: "127.0.0.1",
    API_PORT: "3000",
    API_PUBLIC_URL: "http://localhost:3000",
    WEB_ORIGIN: "http://localhost:5173",
    DATABASE_URL: "postgresql://mindmap:local-password@localhost:15432/share_mind_map",
    REDIS_URL: "redis://default:local-password@localhost:16379",
    MINIO_ENDPOINT: "http://localhost:9000",
    MINIO_ROOT_USER: "mindmap",
    MINIO_ROOT_PASSWORD: "local-minio-password",
    MINIO_BUCKET: "share-mind-map",
    MINIO_USE_SSL: "false",
    SMTP_HOST: "localhost",
    SMTP_PORT: "1025",
    SMTP_SECURE: "false",
    SMTP_FROM: "share-mind-map@localhost",
    SESSION_SECRET: "development-only-secret",
    SESSION_TTL_SECONDS: "86400",
    COOKIE_SECURE: "false",
    COOKIE_SAME_SITE: "lax",
    ARGON2_MEMORY_KIB: "65536",
    ARGON2_ITERATIONS: "3",
    ARGON2_PARALLELISM: "1",
    TRUST_PROXY_COUNT: "2",
    LOG_LEVEL: "debug",
    ...overrides,
  };
}

function productionEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return developmentEnvironment({
    APP_ENV: "production",
    API_PUBLIC_URL: "https://mind.example.com",
    WEB_ORIGIN: "https://mind.example.com",
    DATABASE_URL:
      "postgresql://mindmap:0123456789abcdef0123456789abcdef@database:5432/share_mind_map",
    REDIS_URL: "redis://default:0123456789abcdef0123456789abcdef@redis:6379",
    MINIO_ROOT_PASSWORD: "0123456789abcdef0123456789abcdef",
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    COOKIE_SECURE: "true",
    LOG_LEVEL: "info",
    ...overrides,
  });
}

describe("application configuration", () => {
  it("parses declared values while ignoring unrelated process variables", () => {
    const config = parseAppConfig(developmentEnvironment({ PATH: "/usr/bin" }));

    expect(config).toMatchObject({
      environment: "development",
      host: "127.0.0.1",
      port: 3000,
      cookie: { secure: false, sameSite: "lax" },
      argon2: { memoryKiB: 65_536, iterations: 3, parallelism: 1 },
      smtp: { host: "localhost", port: 1025, secure: false },
      trustProxyCount: 2,
    });
  });

  it("rejects production with an insecure cookie without echoing secrets", () => {
    const secret = "top-secret-value-that-must-not-be-echoed";

    let message = "";
    try {
      parseAppConfig(productionEnvironment({ COOKIE_SECURE: "false", SESSION_SECRET: secret }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/COOKIE_SECURE/);
    expect(message).not.toContain(secret);
  });

  it.each([
    ["short secret", { SESSION_SECRET: "short" }, "SESSION_SECRET"],
    [
      "placeholder secret",
      { SESSION_SECRET: "replace-with-random-hex-value-1234" },
      "SESSION_SECRET",
    ],
    ["HTTP public URL", { API_PUBLIC_URL: "http://mind.example.com" }, "API_PUBLIC_URL"],
    ["wildcard origin", { WEB_ORIGIN: "*" }, "WEB_ORIGIN"],
    ["low Argon2 memory", { ARGON2_MEMORY_KIB: "8192" }, "ARGON2_MEMORY_KIB"],
    [
      "short database password",
      { DATABASE_URL: "postgresql://mindmap:short@database:5432/share_mind_map" },
      "DATABASE_URL",
    ],
    ["short Redis password", { REDIS_URL: "redis://default:short@redis:6379" }, "REDIS_URL"],
    ["short MinIO password", { MINIO_ROOT_PASSWORD: "short" }, "MINIO_ROOT_PASSWORD"],
    ["short SMTP password", { SMTP_USER: "mailer", SMTP_PASSWORD: "short" }, "SMTP_PASSWORD"],
  ])("rejects production %s", (_scenario, overrides, variable) => {
    expect(() => parseAppConfig(productionEnvironment(overrides))).toThrow(variable);
  });

  it("reports variable names and reasons without reporting invalid values", () => {
    const invalidPassword = "minio-password-that-must-stay-private";
    let message = "";

    try {
      parseAppConfig(
        developmentEnvironment({
          MINIO_ENDPOINT: "not-a-url",
          MINIO_ROOT_PASSWORD: invalidPassword,
        }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("MINIO_ENDPOINT");
    expect(message).not.toContain("not-a-url");
    expect(message).not.toContain(invalidPassword);
  });
});
