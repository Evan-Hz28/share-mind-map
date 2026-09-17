import { fileURLToPath } from "node:url";

import { type Job, type Queue, type QueueEvents } from "bullmq";
import type Redis from "ioredis";
import { v7 as uuidv7 } from "uuid";

import { parseWorkerConfig, type WorkerConfig } from "./config.js";
import {
  createRedisConnection,
  createValidationQueue,
  createValidationQueueEvents,
} from "./queue.js";
import {
  loadProcessorDependencies,
  type FixtureManifestEntry,
  type XMindValidationJob,
  type XMindValidationResult,
} from "./processor.js";

interface VerifierResources {
  queueConnection: Redis;
  eventsConnection: Redis;
  queue: Queue<XMindValidationJob, XMindValidationResult>;
  events: QueueEvents;
}

async function createVerifierResources(config: WorkerConfig): Promise<VerifierResources> {
  const queueConnection = createRedisConnection(config.redisUrl);
  const eventsConnection = createRedisConnection(config.redisUrl);
  const queue = createValidationQueue(config, queueConnection);
  const events = createValidationQueueEvents(config, eventsConnection);
  await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
  return { queueConnection, eventsConnection, queue, events };
}

async function closeVerifierResources(resources: VerifierResources): Promise<void> {
  await Promise.all([resources.events.close(), resources.queue.close()]);
  await Promise.all([resources.eventsConnection.quit(), resources.queueConnection.quit()]);
}

function assertExpectedResult(fixture: FixtureManifestEntry, result: XMindValidationResult) {
  if (fixture.expectedStatus === "accepted") {
    if (result.status !== "succeeded" || result.nodeCount !== fixture.expectedNodeCount) {
      throw new Error(`Fixture verification mismatch for ${fixture.file}.`);
    }
    return;
  }
  if (result.status !== "rejected" || result.errorCode !== fixture.expectedErrorCode) {
    throw new Error(`Fixture verification mismatch for ${fixture.file}.`);
  }
}

async function runFixture(
  resources: VerifierResources,
  fixture: FixtureManifestEntry,
): Promise<XMindValidationResult> {
  const data: XMindValidationJob = {
    jobId: uuidv7(),
    fixtureName: fixture.file,
    expectedSha256: fixture.sha256,
  };
  const job: Job<XMindValidationJob, XMindValidationResult> = await resources.queue.add(
    "validate-fixture",
    data,
    {
      jobId: data.jobId,
      removeOnComplete: false,
      removeOnFail: false,
    },
  );
  const result = await job.waitUntilFinished(resources.events, 5 * 60 * 1_000);
  assertExpectedResult(fixture, result);
  await job.remove();
  return result;
}

export async function verifyFixture(
  config: WorkerConfig,
  fixtureName: string,
): Promise<XMindValidationResult> {
  const manifest = await loadProcessorDependencies(config.fixtureRoot);
  const fixture = manifest.fixtures.get(fixtureName);
  if (fixture === undefined) throw new Error(`Fixture ${fixtureName} is not in the manifest.`);
  const resources = await createVerifierResources(config);
  try {
    return await runFixture(resources, fixture);
  } finally {
    await closeVerifierResources(resources);
  }
}

export async function verifyAllFixtures(
  config: WorkerConfig,
  writeLine: (line: string) => void = console.log,
): Promise<number> {
  const manifest = await loadProcessorDependencies(config.fixtureRoot);
  const fixtures = [...manifest.fixtures.values()].sort((left, right) =>
    left.file.localeCompare(right.file),
  );
  const resources = await createVerifierResources(config);
  try {
    const results: { fixture: FixtureManifestEntry; result: XMindValidationResult }[] = [];
    for (let index = 0; index < fixtures.length; index += 3) {
      results.push(
        ...(await Promise.all(
          fixtures
            .slice(index, index + 3)
            .map(async (fixture) => ({ fixture, result: await runFixture(resources, fixture) })),
        )),
      );
    }
    for (const { fixture, result } of results) {
      writeLine(
        JSON.stringify({
          fixture: fixture.file,
          status: result.status,
          ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
          ...(result.nodeCount === undefined ? {} : { nodeCount: result.nodeCount }),
          workerPid: result.workerPid,
        }),
      );
    }
    writeLine(JSON.stringify({ summary: { total: results.length, matched: results.length } }));
    return results.length;
  } finally {
    await closeVerifierResources(resources);
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await verifyAllFixtures(parseWorkerConfig(process.env));
  } catch {
    console.error(JSON.stringify({ error: "fixture_verification_failed" }));
    process.exitCode = 1;
  }
}
