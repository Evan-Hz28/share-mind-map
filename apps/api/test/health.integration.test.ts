import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/main.js";
import {
  createInfrastructureHealthRuntime,
  type InfrastructureHealthRuntime,
} from "../src/health/health.service.js";
import type { AppConfig } from "../src/platform/config/app-config.js";

const config: AppConfig = {
  environment: "test",
  host: "127.0.0.1",
  port: 0,
  apiPublicUrl: new URL("http://localhost:3000"),
  webOrigin: new URL("http://localhost:5173"),
  databaseUrl: "postgresql://mindmap:123456@localhost:15432/share_mind_map",
  redisUrl: "redis://default:123456@localhost:16379",
  minio: {
    endpoint: new URL("http://localhost:9000"),
    accessKey: "mindmap",
    secretKey: "12345678",
    bucket: "share-mind-map",
    useSsl: false,
  },
  smtp: {
    host: "127.0.0.1",
    port: 1025,
    secure: false,
    from: "share-mind-map@localhost",
  },
  sessionSecret: "integration-test-secret",
  sessionTtlSeconds: 86_400,
  documentLockTtlSeconds: 900,
  cookie: { secure: false, sameSite: "lax" },
  argon2: { memoryKiB: 8_192, iterations: 1, parallelism: 1 },
  trustProxyCount: 0,
  queuePrefix: "smm",
  logLevel: "silent",
};

interface HealthResponse {
  status: "ok" | "unavailable";
  components: Record<"postgres" | "redis" | "minio" | "smtp", "ok" | "unavailable">;
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.status !== "ok" && record.status !== "unavailable") return false;
  if (typeof record.components !== "object" || record.components === null) return false;
  const components = record.components as Record<string, unknown>;
  return ["postgres", "redis", "minio", "smtp"].every(
    (component) => components[component] === "ok" || components[component] === "unavailable",
  );
}

async function waitForReady(server: Server) {
  let latest: request.Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    latest = await request(server).get("/health/ready");
    if (latest.status === 200) return latest;
    expect(latest.status).toBe(503);
    const body: unknown = latest.body;
    expect(isHealthResponse(body)).toBe(true);
    if (isHealthResponse(body)) expect(body.status).toBe("unavailable");
  }
  throw new Error(`Readiness did not converge after 3 probes: ${latest?.text ?? "no response"}`);
}

describe("API health endpoints with real dependencies", () => {
  let runtime: InfrastructureHealthRuntime;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    runtime = createInfrastructureHealthRuntime(config);
    app = await createApp({ config, healthChecks: runtime.checks });
  });

  afterAll(async () => {
    await app.close();
    await runtime.close();
  });

  it("serves liveness without dependency details", async () => {
    const response = await request(app.getHttpServer() as Server).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("reports PostgreSQL, Redis, private MinIO, and SMTP ready", async () => {
    const response = await waitForReady(app.getHttpServer() as Server);

    expect(response.body).toEqual({
      status: "ok",
      components: { postgres: "ok", redis: "ok", minio: "ok", smtp: "ok" },
    });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain("123456");
    expect(response.text).not.toContain("12345678");
  });

  it("returns 503 with safe component names when a required dependency is unavailable", async () => {
    const failingApp = await createApp({
      config,
      healthChecks: {
        postgres: () => Promise.resolve(),
        redis: () => Promise.reject(new Error("redis://default:secret@private-host")),
        minio: () => Promise.resolve(),
        smtp: () => Promise.resolve(),
      },
    });
    try {
      const response = await request(failingApp.getHttpServer() as Server).get("/health/ready");

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: "unavailable",
        components: { postgres: "ok", redis: "unavailable", minio: "ok", smtp: "ok" },
      });
      expect(response.text).not.toContain("secret");
      expect(response.text).not.toContain("private-host");
    } finally {
      await failingApp.close();
    }
  });
});
import type { Server } from "node:http";
