import type { Server } from "node:http";
import { fileURLToPath } from "node:url";

import { createDatabase, migrateDatabase, type Database } from "@share-mind-map/database";
import type { INestApplication } from "@nestjs/common";
import Redis from "ioredis";
import request from "supertest";

import { AdminOperationsService } from "../../src/operations/admin-operations.service.js";
import { createApp } from "../../src/main.js";
import type { AppConfig } from "../../src/platform/config/app-config.js";
import { RecordingCommandIO } from "./recording-command-io.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url)));
} catch {
  // CI supplies test connection URLs directly instead of a repository .env file.
}

export const authTestConfig: AppConfig = {
  environment: "test",
  host: "127.0.0.1",
  port: 0,
  apiPublicUrl: new URL("http://localhost:3000"),
  webOrigin: new URL("http://localhost:5173"),
  databaseUrl:
    process.env.TEST_DATABASE_URL ?? "postgresql://mindmap:123456@localhost:15432/share_mind_map",
  redisUrl:
    process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://default:123456@localhost:16379",
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
  sessionSecret: "task-nine-integration-session-secret-value",
  sessionTtlSeconds: 86_400,
  documentLockTtlSeconds: 900,
  cookie: { secure: false, sameSite: "lax" },
  argon2: { memoryKiB: 8_192, iterations: 1, parallelism: 1 },
  trustProxyCount: 0,
  queuePrefix: "smm",
  logLevel: "silent",
};

export interface AuthenticatedSession {
  cookie: string;
  csrfToken: string;
  body: Record<string, unknown>;
}

export interface AuthTestRuntime {
  app: INestApplication;
  server: Server;
  database: Database;
  redis: Redis;
  operations: AdminOperationsService;
}

export function responseBody(response: request.Response): unknown {
  const body: unknown = response.body;
  return body;
}

const readyChecks = {
  postgres: () => Promise.resolve(),
  redis: () => Promise.resolve(),
  minio: () => Promise.resolve(),
  smtp: () => Promise.resolve(),
};

async function deleteKeys(redis: Redis, pattern: string): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== "0");
}

export async function startAuthTestRuntime(): Promise<AuthTestRuntime> {
  const database = createDatabase(authTestConfig.databaseUrl);
  await migrateDatabase(database);
  const redis = new Redis(authTestConfig.redisUrl, { maxRetriesPerRequest: 1 });
  const app = await createApp({ config: authTestConfig, healthChecks: readyChecks });
  await app.listen(0, "127.0.0.1");
  return {
    app,
    server: app.getHttpServer() as Server,
    database,
    redis,
    operations: app.get(AdminOperationsService),
  };
}

export async function resetAuthTestRuntime(runtime: AuthTestRuntime): Promise<void> {
  await runtime.database.$client.query(
    `TRUNCATE TABLE audit_logs, workspace_memberships, auth_identities, users, workspaces,
       organizations CASCADE`,
  );
  await deleteKeys(runtime.redis, "smm:auth:*");
  await deleteKeys(runtime.redis, "smm:login-limit:*");
  await deleteKeys(runtime.redis, "smm:lock:*");
}

export async function stopAuthTestRuntime(runtime?: AuthTestRuntime): Promise<void> {
  if (runtime === undefined) return;
  await runtime.app.close();
  await runtime.database.$client.end();
  await runtime.redis.quit();
}

export async function initializeDefaultAdmin(
  runtime: AuthTestRuntime,
  loginName = "Admin.One",
): Promise<{ password: string; io: RecordingCommandIO }> {
  const io = new RecordingCommandIO([
    "Test Organization",
    "Default Workspace",
    loginName,
    "First Admin",
  ]);
  const result = await runtime.operations.initialize(io);
  if (result.status !== "initialized") throw new Error(`Initialization failed: ${result.status}`);
  const password = io.secrets[0]?.value;
  if (password === undefined) throw new Error("Initialization did not reveal a temporary password");
  return { password, io };
}

export async function login(
  runtime: AuthTestRuntime,
  loginName: string,
  password: string,
): Promise<{ response: request.Response; session?: AuthenticatedSession }> {
  const response = await request(runtime.server)
    .post("/api/v1/auth/login")
    .send({ loginName, password });
  const setCookie: unknown = response.headers["set-cookie"];
  const firstCookie: unknown = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookieHeader = typeof firstCookie === "string" ? firstCookie : undefined;
  const cookie = typeof cookieHeader === "string" ? cookieHeader.split(";", 1)[0] : undefined;
  const body = responseBody(response) as Record<string, unknown>;
  const csrfToken = body.csrfToken;
  return {
    response,
    ...(cookie === undefined || typeof csrfToken !== "string"
      ? {}
      : { session: { cookie, csrfToken, body } }),
  };
}

export async function changePassword(
  runtime: AuthTestRuntime,
  session: AuthenticatedSession,
  currentPassword: string,
  newPassword: string,
): Promise<request.Response> {
  return request(runtime.server)
    .put("/api/v1/auth/password")
    .set("Cookie", session.cookie)
    .set("X-CSRF-Token", session.csrfToken)
    .send({ currentPassword, newPassword });
}

export async function authenticatedAdmin(
  runtime: AuthTestRuntime,
  permanentPassword = "Permanent-Admin-Password-1",
): Promise<AuthenticatedSession> {
  const { password } = await initializeDefaultAdmin(runtime);
  const temporaryLogin = await login(runtime, "admin.one", password);
  if (temporaryLogin.session === undefined) throw new Error("Temporary Admin login failed");
  const changed = await changePassword(
    runtime,
    temporaryLogin.session,
    password,
    permanentPassword,
  );
  if (changed.status !== 204) throw new Error(`Password change failed: ${String(changed.status)}`);
  const permanentLogin = await login(runtime, "admin.one", permanentPassword);
  if (permanentLogin.session === undefined) throw new Error("Permanent Admin login failed");
  return permanentLogin.session;
}
