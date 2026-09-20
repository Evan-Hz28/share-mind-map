import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser } from "@playwright/test";

import type {
  CanvasBenchmarkMeasurement,
  CanvasCapabilities,
  CanvasCandidate,
} from "../apps/web/src/poc/types.js";
import { collectCanvasLicenses, type CanvasLicenseEvidence } from "./canvas-license-check.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDirectory = join(rootDirectory, "apps/web");
const outputDirectory = join(rootDirectory, "docs/benchmarks/canvas");
const resultsPath = join(outputDirectory, "results.json");
const environmentPath = join(outputDirectory, "environment.json");
const candidates: CanvasCandidate[] = ["simple-mind-map", "mind-elixir", "jsmind"];
const nodeCounts = [100, 5_000, 20_000];
const recordedRunCount = 3;

export type BenchmarkRun =
  | {
      status: "succeeded";
      measurement: CanvasBenchmarkMeasurement;
      consoleErrors?: string[];
      failedRequests?: string[];
      externalCloudRequests?: string[];
    }
  | {
      status: "failed";
      error: string;
      consoleErrors?: string[];
      failedRequests?: string[];
      externalCloudRequests?: string[];
    };

export type BenchmarkSummary = {
  successfulRuns: number;
  failedRuns: number;
  medians: {
    mountMs: number | null;
    firstUsableMs: number | null;
    replacementMs: number | null;
    interactionMs: number | null;
    heapAfterMount: number | null;
    heapAfterDestroy: number | null;
  };
};

export function performanceGateErrors(
  candidate: string,
  samples: readonly {
    nodeCount: number;
    medians: { firstUsableMs: number | null; interactionMs: number | null };
  }[],
): string[] {
  if (candidate !== "mind-elixir") return [];
  const errors: string[] = [];
  const fiveThousand = samples.find((sample) => sample.nodeCount === 5_000);
  const twentyThousand = samples.find((sample) => sample.nodeCount === 20_000);
  if ((fiveThousand?.medians.interactionMs ?? Infinity) > 3_000) {
    errors.push("mind-elixir 5,000-node interaction exceeds the 3,000 ms gate.");
  }
  if ((twentyThousand?.medians.firstUsableMs ?? Infinity) > 5_000) {
    errors.push("mind-elixir 20,000-node first usable exceeds the 5,000 ms gate.");
  }
  return errors;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : sorted[middle];
  return value === undefined ? null : round(value);
}

export function summarizeRuns(runs: readonly BenchmarkRun[]): BenchmarkSummary {
  const successful = runs.filter(
    (run): run is Extract<BenchmarkRun, { status: "succeeded" }> => run.status === "succeeded",
  );
  const values = (selector: (measurement: CanvasBenchmarkMeasurement) => number): number[] =>
    successful.map((run) => selector(run.measurement)).filter(Number.isFinite);
  const heapValues = (key: "afterMount" | "afterDestroy"): number[] =>
    successful
      .map((run) => run.measurement.heap[key])
      .filter((value): value is number => value !== null && Number.isFinite(value));

  return {
    successfulRuns: successful.length,
    failedRuns: runs.length - successful.length,
    medians: {
      mountMs: median(values((measurement) => measurement.mountMs)),
      firstUsableMs: median(values((measurement) => measurement.firstUsableMs)),
      replacementMs: median(values((measurement) => measurement.replacementMs)),
      interactionMs: median(values((measurement) => measurement.interactionMs)),
      heapAfterMount: median(heapValues("afterMount")),
      heapAfterDestroy: median(heapValues("afterDestroy")),
    },
  };
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Unable to allocate a port.");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForServer(
  url: string,
  process: ChildProcessWithoutNullStreams,
  output: string[],
): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        `Canvas server exited ${String(process.exitCode)}: ${output.slice(-10).join("")}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The loop reports process output if readiness never succeeds.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Canvas server did not become ready: ${output.slice(-10).join("")}`);
}

function startServer(port: number): { process: ChildProcessWithoutNullStreams; output: string[] } {
  const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  delete environment["FORCE_COLOR"];
  const vitePath = join(webDirectory, "node_modules/vite/bin/vite.js");
  const child = spawn(
    process.execPath,
    [vitePath, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: webDirectory, env: environment, stdio: ["pipe", "pipe", "pipe"] },
  );
  const output: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  return { process: child, output };
}

async function stopServer(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    once(process, "exit"),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timed out after ${String(milliseconds)} ms.`));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function isExternalRequest(url: string, port: number): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) return false;
  const parsed = new URL(url);
  return parsed.hostname !== "127.0.0.1" || parsed.port !== String(port);
}

async function recordRun(
  browser: Browser,
  port: number,
  candidate: CanvasCandidate,
  nodeCount: number,
): Promise<{ run: BenchmarkRun; capabilities: CanvasCapabilities | null }> {
  const context = await browser.newContext({ viewport: { width: 1_440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const externalCloudRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("request", (request) => {
    if (isExternalRequest(request.url(), port)) externalCloudRequests.push(request.url());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? "unknown error"}`);
  });

  try {
    await page.goto(
      `http://127.0.0.1:${String(port)}/poc.html?candidate=${candidate}&nodes=${String(nodeCount)}`,
      { waitUntil: "domcontentloaded", timeout: 120_000 },
    );
    await page.waitForFunction(() => window.__CANVAS_POC__?.ready === true, undefined, {
      timeout: 300_000,
    });
    const runtime = await page.evaluate(() => {
      const value = window.__CANVAS_POC__;
      if (value === undefined) throw new Error("Canvas runtime is absent.");
      return { capabilities: value.capabilities, errors: value.errors };
    });
    if (runtime.errors.length > 0) throw new Error(runtime.errors.join("; "));
    const measurement = await withTimeout(
      page.evaluate(async () => {
        const value = window.__CANVAS_POC__;
        if (value === undefined) throw new Error("Canvas runtime is absent.");
        return value.runBenchmark();
      }),
      300_000,
    );
    return {
      capabilities: runtime.capabilities,
      run: {
        status: "succeeded",
        measurement,
        consoleErrors: unique(consoleErrors),
        failedRequests: unique(failedRequests),
        externalCloudRequests: unique(externalCloudRequests),
      },
    };
  } catch (error) {
    return {
      capabilities: null,
      run: {
        status: "failed",
        error: errorMessage(error),
        consoleErrors: unique(consoleErrors),
        failedRequests: unique(failedRequests),
        externalCloudRequests: unique(externalCloudRequests),
      },
    };
  } finally {
    await context.close();
  }
}

const noCapabilities: CanvasCapabilities = {
  readOnly: false,
  stableIds: false,
  createDelete: false,
  reparenting: false,
  reordering: false,
  collapse: false,
  keyboardHooks: false,
  zoomPan: false,
  undoHook: false,
  image: false,
  label: false,
  icon: false,
  basicStyle: false,
  snapshotReplacement: false,
  stateRestoration: false,
  deterministicExport: false,
  cleanup: false,
  noCloudDependency: false,
};

function licenseFor(
  licenses: readonly CanvasLicenseEvidence[],
  candidate: CanvasCandidate,
): CanvasLicenseEvidence {
  const license = licenses.find((entry) => entry.packageName === candidate);
  if (license === undefined) throw new Error(`License evidence is missing for ${candidate}.`);
  return license;
}

async function readPackageVersion(path: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string") throw new Error(`Version is missing in ${path}.`);
  return manifest.version;
}

export async function runCanvasBenchmark(): Promise<void> {
  const licenses = await collectCanvasLicenses();
  const port = await availablePort();
  const server = startServer(port);
  await waitForServer(`http://127.0.0.1:${String(port)}/poc.html`, server.process, server.output);
  const browser = await chromium.launch({
    args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
  });

  try {
    const packageVersions = Object.fromEntries(
      licenses.map((license) => [license.packageName, license.version]),
    );
    const generatedAt = new Date().toISOString();
    const candidateResults = [];
    for (const candidate of candidates) {
      const sampleResults = [];
      let candidateCapabilities: CanvasCapabilities | null = null;
      const allExternalRequests: string[] = [];
      for (const nodeCount of nodeCounts) {
        process.stdout.write(`Benchmarking ${candidate} with ${String(nodeCount)} nodes.\n`);
        const warmup = await recordRun(browser, port, candidate, nodeCount);
        candidateCapabilities ??= warmup.capabilities;
        allExternalRequests.push(...(warmup.run.externalCloudRequests ?? []));
        const runs: BenchmarkRun[] = [];
        for (let index = 0; index < recordedRunCount; index += 1) {
          const recorded = await recordRun(browser, port, candidate, nodeCount);
          candidateCapabilities ??= recorded.capabilities;
          allExternalRequests.push(...(recorded.run.externalCloudRequests ?? []));
          runs.push(recorded.run);
        }
        const summary = summarizeRuns(runs);
        sampleResults.push({
          nodeCount,
          warmup: warmup.run,
          runs,
          ...summary,
          medianFirstUsableMs: summary.medians.firstUsableMs,
          medianHeapAfterMount: summary.medians.heapAfterMount,
        });
      }
      const license = licenseFor(licenses, candidate);
      candidateResults.push({
        candidate,
        packageVersion: license.version,
        licenseCompatible: license.compatible,
        license,
        externalCloudRequests: unique(allExternalRequests),
        capabilities: candidateCapabilities ?? noCapabilities,
        samples: sampleResults,
      });
    }

    const results = {
      schemaVersion: 1,
      generatedAt,
      browser: { name: "chromium", version: browser.version() },
      protocol: { warmupRuns: 1, recordedRuns: recordedRunCount, nodeCounts },
      candidates: candidateResults,
    };
    const performanceErrors = candidateResults.flatMap((candidate) =>
      performanceGateErrors(candidate.candidate, candidate.samples),
    );
    const cpuList = cpus();
    const environment = {
      schemaVersion: 1,
      capturedAt: generatedAt,
      os: { platform: platform(), release: release(), architecture: process.arch },
      cpu: { model: cpuList[0]?.model ?? "unknown", logicalCores: cpuList.length },
      memory: { totalBytes: totalmem(), freeBytesAtCapture: freemem() },
      runtime: {
        node: process.version,
        pnpm: "11.5.0",
        playwright: await readPackageVersion(
          join(rootDirectory, "node_modules/@playwright/test/package.json"),
        ),
        chromium: browser.version(),
      },
      packageVersions,
      launchArguments: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
      syntheticSamples: true,
    };
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8"),
      writeFile(environmentPath, `${JSON.stringify(environment, null, 2)}\n`, "utf8"),
    ]);
    if (performanceErrors.length > 0) {
      throw new Error(`Canvas performance gate failed:\n${performanceErrors.join("\n")}`);
    }
    process.stdout.write(`${resultsPath}\n${environmentPath}\n`);
  } finally {
    await browser.close();
    await stopServer(server.process);
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await runCanvasBenchmark();
}
