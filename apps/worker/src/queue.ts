import { Queue, QueueEvents, Worker } from "bullmq";
import Redis from "ioredis";
import type { Database } from "@share-mind-map/database";
import type { ObjectStorage } from "@share-mind-map/storage";

import type { WorkerConfig } from "./config.js";
import {
  loadProcessorDependencies,
  processJob,
  type XMindValidationJob,
  type XMindValidationResult,
} from "./processor.js";
import { processProductionImport, type ProductionImportJob } from "./import/processor.js";

export const XMIND_VALIDATION_QUEUE = "xmind-validation";
export const XMIND_IMPORT_QUEUE = "xmind-import";

export function createRedisConnection(url: string): Redis {
  return new Redis(url, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
  });
}

export function createValidationQueue(config: WorkerConfig, connection: Redis) {
  return new Queue<XMindValidationJob, XMindValidationResult>(XMIND_VALIDATION_QUEUE, {
    connection,
    prefix: config.queuePrefix,
  });
}

export function createValidationQueueEvents(config: WorkerConfig, connection: Redis) {
  return new QueueEvents(XMIND_VALIDATION_QUEUE, {
    connection,
    prefix: config.queuePrefix,
  });
}

export async function createValidationWorker(config: WorkerConfig, connection: Redis) {
  const dependencies = await loadProcessorDependencies(config.fixtureRoot);
  return new Worker<XMindValidationJob, XMindValidationResult>(
    XMIND_VALIDATION_QUEUE,
    async (job) => processJob(job.data, dependencies),
    {
      connection,
      prefix: config.queuePrefix,
      concurrency: 3,
    },
  );
}

export function createImportQueue(config: WorkerConfig, connection: Redis) {
  return new Queue<ProductionImportJob>(XMIND_IMPORT_QUEUE, {
    connection,
    prefix: config.queuePrefix,
  });
}

export function createImportWorker(
  config: WorkerConfig,
  connection: Redis,
  database: Database,
  storage: ObjectStorage,
) {
  return new Worker<ProductionImportJob>(
    XMIND_IMPORT_QUEUE,
    async (job) => {
      await processProductionImport(job.data, {
        database,
        storage,
        deadline: Date.now() + 5 * 60 * 1000,
      });
    },
    {
      connection,
      prefix: config.queuePrefix,
      concurrency: 3,
      lockDuration: 5 * 60 * 1000,
    },
  );
}
