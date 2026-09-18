import { fileURLToPath } from "node:url";

import { createDatabase } from "@share-mind-map/database";
import { Client as MinioClient } from "minio";
import { Pool } from "pg";

import { parseWorkerConfig, type WorkerConfig } from "./config.js";
import { startHealthServer, type HealthServer } from "./health-server.js";
import { createRedisConnection, createValidationQueue, createValidationWorker } from "./queue.js";
import { NotificationOutboxProcessor } from "./notification-outbox.processor.js";

export interface WorkerRuntime {
  pid: number;
  health: HealthServer;
  close(): Promise<void>;
}

function createMinioClient(config: WorkerConfig): MinioClient {
  const endpoint = new URL(config.minioEndpoint);
  return new MinioClient({
    endPoint: endpoint.hostname,
    port:
      endpoint.port === "" ? (endpoint.protocol === "https:" ? 443 : 80) : Number(endpoint.port),
    useSSL: endpoint.protocol === "https:",
    accessKey: config.minioAccessKey,
    secretKey: config.minioSecretKey,
  });
}

export async function startWorker(config: WorkerConfig): Promise<WorkerRuntime> {
  const workerConnection = createRedisConnection(config.redisUrl);
  const queueConnection = createRedisConnection(config.redisUrl);
  const healthRedis = createRedisConnection(config.redisUrl);
  const pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 1_000 });
  const notificationDatabase = createDatabase(config.databaseUrl);
  const notifications = new NotificationOutboxProcessor(notificationDatabase);
  const notificationTimer = setInterval(() => {
    void notifications.processBatch().catch(() => undefined);
  }, 1_000);
  const minio = createMinioClient(config);
  const queue = createValidationQueue(config, queueConnection);
  const worker = await createValidationWorker(config, workerConnection);
  await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);

  const health = await startHealthServer({
    host: config.host,
    port: config.port,
    timeoutMs: 1_000,
    checks: {
      postgres: async () => {
        await pool.query("SELECT 1");
      },
      redis: async () => {
        await healthRedis.ping();
      },
      minio: async () => {
        const exists = await minio.bucketExists(config.minioBucket);
        if (!exists) throw new Error("required bucket is unavailable");
      },
      queue: async () => {
        await queue.waitUntilReady();
      },
    },
  });

  let closed = false;
  return {
    pid: process.pid,
    health,
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(notificationTimer);
      await health.close();
      await Promise.all([worker.close(), queue.close()]);
      await Promise.all([workerConnection.quit(), queueConnection.quit(), healthRedis.quit()]);
      await Promise.all([pool.end(), notificationDatabase.$client.end()]);
    },
  };
}

async function run() {
  const runtime = await startWorker(parseWorkerConfig(process.env));
  console.log(
    JSON.stringify({
      event: "worker.started",
      pid: runtime.pid,
      healthPort: runtime.health.port,
      queue: "xmind-validation",
    }),
  );
  const shutdown = async () => {
    await runtime.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await run();
  } catch {
    console.error(JSON.stringify({ event: "worker.start_failed" }));
    process.exitCode = 1;
  }
}
