import { fileURLToPath } from "node:url";

import { createDatabase } from "@share-mind-map/database";
import { MinioObjectStorage } from "@share-mind-map/storage";
import { Pool } from "pg";

import { parseWorkerConfig, type WorkerConfig } from "./config.js";
import { startHealthServer, type HealthServer } from "./health-server.js";
import {
  createApiTestQueue,
  createApiTestWorker,
  createImportQueue,
  createImportWorker,
  createRedisConnection,
  createValidationQueue,
  createValidationWorker,
} from "./queue.js";
import { NotificationOutboxProcessor } from "./notification-outbox.processor.js";

export interface WorkerRuntime {
  pid: number;
  health: HealthServer;
  close(): Promise<void>;
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
  const storage = new MinioObjectStorage({
    endpoint: new URL(config.minioEndpoint),
    accessKey: config.minioAccessKey,
    secretKey: config.minioSecretKey,
    bucket: config.minioBucket,
    useSsl: new URL(config.minioEndpoint).protocol === "https:",
  });
  const queue = createValidationQueue(config, queueConnection);
  const worker = await createValidationWorker(config, workerConnection);
  const importConnection = createRedisConnection(config.redisUrl);
  const importQueue = createImportQueue(config, importConnection);
  const importWorkerConnection = createRedisConnection(config.redisUrl);
  const importDatabase = createDatabase(config.databaseUrl);
  const importWorker = createImportWorker(config, importWorkerConnection, importDatabase, storage);
  const apiTestConnection = createRedisConnection(config.redisUrl);
  const apiTestQueue = createApiTestQueue(config, apiTestConnection);
  const apiTestWorkerConnection = createRedisConnection(config.redisUrl);
  const apiTestDatabase = createDatabase(config.databaseUrl);
  const apiTestWorker = createApiTestWorker(config, apiTestWorkerConnection, apiTestDatabase);
  await Promise.all([
    queue.waitUntilReady(),
    worker.waitUntilReady(),
    importQueue.waitUntilReady(),
    importWorker.waitUntilReady(),
    apiTestQueue.waitUntilReady(),
    apiTestWorker.waitUntilReady(),
  ]);

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
        const exists = await storage.client.bucketExists(config.minioBucket);
        if (!exists) throw new Error("required bucket is unavailable");
      },
      queue: async () => {
        await Promise.all([
          queue.waitUntilReady(),
          importQueue.waitUntilReady(),
          apiTestQueue.waitUntilReady(),
        ]);
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
      await Promise.all([
        worker.close(),
        queue.close(),
        importWorker.close(),
        importQueue.close(),
        apiTestWorker.close(),
        apiTestQueue.close(),
      ]);
      await Promise.all([
        workerConnection.quit(),
        queueConnection.quit(),
        importWorkerConnection.quit(),
        importConnection.quit(),
        apiTestWorkerConnection.quit(),
        apiTestConnection.quit(),
        healthRedis.quit(),
      ]);
      await Promise.all([
        pool.end(),
        notificationDatabase.$client.end(),
        importDatabase.$client.end(),
        apiTestDatabase.$client.end(),
      ]);
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
