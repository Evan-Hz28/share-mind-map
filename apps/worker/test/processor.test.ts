import { afterEach, describe, expect, it } from "vitest";

import { parseWorkerConfig } from "../src/config.js";
import { startHealthServer, type HealthServer } from "../src/health-server.js";
import {
  loadProcessorDependencies,
  processJob,
  type XMindValidationJob,
} from "../src/processor.js";

const fixtureRoot = new URL("../../../tests/fixtures/xmind/", import.meta.url).pathname;
const openServers: HealthServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(async (server) => server.close()));
});

function job(patch: Partial<XMindValidationJob> = {}): XMindValidationJob {
  return {
    jobId: "00000000-0000-7000-8000-000000000100",
    fixtureName: "current-json.xmind",
    expectedSha256: "3b54f6c00433b48b05c3f5b99bbc0d3489408371725c9204c342472e06b18006",
    ...patch,
  };
}

describe("worker configuration", () => {
  it("ignores unrelated process environment variables", () => {
    expect(() =>
      parseWorkerConfig({
        PATH: "/usr/bin",
        WORKER_PORT: "3001",
        WORKER_HOST: "127.0.0.1",
        DATABASE_URL: "postgresql://worker:password@localhost:15432/share_mind_map",
        REDIS_URL: "redis://default:password@localhost:16379",
        MINIO_ENDPOINT: "http://localhost:9000",
        MINIO_ROOT_USER: "mindmap",
        MINIO_ROOT_PASSWORD: "password",
        MINIO_BUCKET: "share-mind-map",
        XMIND_QUEUE_PREFIX: "smm-test",
        XMIND_FIXTURE_ROOT: fixtureRoot,
      }),
    ).not.toThrow();
  });

  it("rejects a relative fixture root without echoing secrets", () => {
    const secret = "do-not-echo-this-secret";
    let error: unknown;
    try {
      parseWorkerConfig({
        WORKER_PORT: "3001",
        WORKER_HOST: "127.0.0.1",
        DATABASE_URL: `postgresql://worker:${secret}@localhost:15432/share_mind_map`,
        REDIS_URL: `redis://default:${secret}@localhost:16379`,
        MINIO_ENDPOINT: "http://localhost:9000",
        MINIO_ROOT_USER: "mindmap",
        MINIO_ROOT_PASSWORD: secret,
        MINIO_BUCKET: "share-mind-map",
        XMIND_QUEUE_PREFIX: "smm-test",
        XMIND_FIXTURE_ROOT: "tests/fixtures/xmind",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("XMIND_FIXTURE_ROOT");
    expect((error as Error).message).not.toContain(secret);
  });
});

describe("XMind validation processor", () => {
  it("resolves only manifest fixture names", async () => {
    const dependencies = await loadProcessorDependencies(fixtureRoot);

    await expect(
      processJob(job({ fixtureName: "../../target.md" }), dependencies),
    ).rejects.toMatchObject({ code: "FIXTURE_NOT_ALLOWED" });
  });

  it("verifies the manifest hash before opening a fixture", async () => {
    const dependencies = await loadProcessorDependencies(fixtureRoot);

    await expect(
      processJob(job({ expectedSha256: "0".repeat(64) }), dependencies),
    ).rejects.toMatchObject({ code: "FIXTURE_HASH_MISMATCH" });
  });

  it("returns only a safe success summary for an accepted fixture", async () => {
    const dependencies = await loadProcessorDependencies(fixtureRoot);
    const result = await processJob(job(), dependencies);

    expect(result).toEqual({
      jobId: job().jobId,
      workerPid: process.pid,
      status: "succeeded",
      nodeCount: 3,
      compatibility: [],
    });
    expect(JSON.stringify(result)).not.toMatch(/Current root|Root notes|image|password/i);
  });

  it("returns the stable parser code for an allowed hostile fixture", async () => {
    const dependencies = await loadProcessorDependencies(fixtureRoot);
    const result = await processJob(
      job({
        fixtureName: "path-traversal.xmind",
        expectedSha256: "f642e00881e2f684e7e02c37d6ddf4cddf4fdd7c8460524bb4ecb55961a943c1",
      }),
      dependencies,
    );

    expect(result).toMatchObject({
      jobId: job().jobId,
      workerPid: process.pid,
      status: "rejected",
      errorCode: "ARCHIVE_PATH_UNSAFE",
    });
  });
});

describe("worker health server", () => {
  it("keeps liveness dependency-free and bounds readiness output", async () => {
    const calls = { postgres: 0, redis: 0, minio: 0, queue: 0 };
    const server = await startHealthServer({
      host: "127.0.0.1",
      port: 0,
      timeoutMs: 100,
      checks: {
        postgres: () => {
          calls.postgres += 1;
          return Promise.resolve();
        },
        redis: () => {
          calls.redis += 1;
          return Promise.resolve();
        },
        minio: () => {
          calls.minio += 1;
          return Promise.reject(new Error("secret dependency detail"));
        },
        queue: () => {
          calls.queue += 1;
          return Promise.resolve();
        },
      },
    });
    openServers.push(server);

    const live = await fetch(`http://127.0.0.1:${String(server.port)}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "ok" });
    expect(calls).toEqual({ postgres: 0, redis: 0, minio: 0, queue: 0 });

    const ready = await fetch(`http://127.0.0.1:${String(server.port)}/health/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({
      status: "unavailable",
      components: { postgres: "ok", redis: "ok", minio: "unavailable", queue: "ok" },
    });
  });
});
