import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseWorkerConfig, type WorkerConfig } from "../src/config.js";
import { verifyAllFixtures, verifyFixture } from "../src/verify-fixtures.js";

const fixtureRoot = new URL("../../../tests/fixtures/xmind/", import.meta.url).pathname;
let child: ChildProcess | undefined;
let config: WorkerConfig;

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a worker test port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  return address.port;
}

async function waitForWorker(process: ChildProcess): Promise<void> {
  const stdout = process.stdout;
  if (stdout === null) throw new Error("Worker stdout was not captured.");
  let output = "";
  for await (const chunk of stdout as AsyncIterable<Buffer>) {
    output += chunk.toString("utf8");
    if (output.includes('"event":"worker.started"')) return;
  }
  throw new Error(`Worker exited before startup: ${output}`);
}

beforeAll(async () => {
  const workerEnvironment = {
    WORKER_PORT: String(await availablePort()),
    WORKER_HOST: "127.0.0.1",
    DATABASE_URL: "postgresql://mindmap:123456@localhost:15432/share_mind_map",
    REDIS_URL: "redis://default:123456@localhost:16379",
    MINIO_ENDPOINT: "http://localhost:9000",
    MINIO_ROOT_USER: "mindmap",
    MINIO_ROOT_PASSWORD: "12345678",
    MINIO_BUCKET: "share-mind-map",
    XMIND_QUEUE_PREFIX: `smm-integration-${String(process.pid)}`,
    XMIND_FIXTURE_ROOT: fixtureRoot,
  };
  config = parseWorkerConfig(workerEnvironment);
  child = spawn("pnpm", ["exec", "tsx", "src/main.ts"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, ...workerEnvironment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForWorker(child);
}, 20_000);

afterAll(async () => {
  if (child === undefined || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit");
});

describe("independent XMind worker", () => {
  it("parses in a worker process rather than the verifier process", async () => {
    const result = await verifyFixture(config, "current-json.xmind");

    expect(result.workerPid).not.toBe(process.pid);
    expect(result.status).toBe("succeeded");
    expect(result.nodeCount).toBe(3);
  });

  it("reports all required dependencies ready without API configuration", async () => {
    const ready = await fetch(`http://127.0.0.1:${String(config.port)}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      status: "ok",
      components: { postgres: "ok", redis: "ok", minio: "ok", queue: "ok" },
    });
  });

  it("verifies all fixtures without exceeding the queue listener limit", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error): void => {
      if (warning.name === "MaxListenersExceededWarning") warnings.push(warning.message);
    };
    process.on("warning", onWarning);

    try {
      const lines: string[] = [];
      expect(await verifyAllFixtures(config, (line) => lines.push(line))).toBe(12);
      expect(JSON.parse(lines.at(-1) ?? "null")).toEqual({
        summary: { total: 12, matched: 12 },
      });
    } finally {
      process.off("warning", onWarning);
    }

    expect(warnings).toEqual([]);
  });
});
