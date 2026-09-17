import { Queue, QueueEvents, Worker } from "bullmq";
import Redis from "ioredis";

import type { WorkerConfig } from "./config.js";
import {
  loadProcessorDependencies,
  processJob,
  type XMindValidationJob,
  type XMindValidationResult,
} from "./processor.js";

export const XMIND_VALIDATION_QUEUE = "xmind-validation";

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
