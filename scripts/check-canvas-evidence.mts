import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { CanvasCandidate } from "../apps/web/src/poc/types.js";
import { summarizeRuns, type BenchmarkRun, type BenchmarkSummary } from "./canvas-benchmark.mjs";
import { collectCanvasLicenses, type CanvasLicenseEvidence } from "./canvas-license-check.mjs";
import {
  renderCanvasAdrContent,
  type CanvasDecisionCandidate,
  type CanvasResults,
} from "./render-canvas-adr.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDirectory = join(rootDirectory, "docs/benchmarks/canvas");
const resultsPath = join(evidenceDirectory, "results.json");
const environmentPath = join(evidenceDirectory, "environment.json");
const adrPath = join(rootDirectory, "docs/adr/0001-canvas-component.md");
const expectedCandidates: CanvasCandidate[] = ["simple-mind-map", "mind-elixir", "jsmind"];
const expectedNodeCounts = [100, 5_000, 20_000];

export type BenchmarkMatrixCandidate = {
  candidate: string;
  samples: { nodeCount: number; runs: unknown[] }[];
};

type StoredSample = CanvasDecisionCandidate["samples"][number] &
  BenchmarkSummary & {
    warmup: BenchmarkRun;
    runs: BenchmarkRun[];
  };

type StoredCandidate = Omit<CanvasDecisionCandidate, "samples"> & {
  packageVersion: string;
  license: CanvasLicenseEvidence;
  samples: StoredSample[];
};

type StoredResults = Omit<CanvasResults, "candidates"> & {
  browser: { name: string; version: string };
  protocol: { warmupRuns: number; recordedRuns: number; nodeCounts: number[] };
  candidates: StoredCandidate[];
};

export function validateBenchmarkMatrix(input: readonly BenchmarkMatrixCandidate[]): string[] {
  const errors: string[] = [];
  for (const candidate of expectedCandidates) {
    const entries = input.filter((entry) => entry.candidate === candidate);
    if (entries.length === 0) {
      errors.push(`${candidate} is missing from benchmark results.`);
      continue;
    }
    if (entries.length > 1) errors.push(`${candidate} appears more than once.`);
    const entry = entries[0];
    if (entry === undefined) continue;
    for (const nodeCount of expectedNodeCounts) {
      const samples = entry.samples.filter((sample) => sample.nodeCount === nodeCount);
      if (samples.length === 0) {
        errors.push(`${candidate} is missing the ${String(nodeCount)}-node sample.`);
        continue;
      }
      if (samples.length > 1) {
        errors.push(`${candidate} has duplicate ${String(nodeCount)}-node samples.`);
      }
      const sample = samples[0];
      if (sample !== undefined && sample.runs.length !== 3) {
        errors.push(
          `${candidate} ${String(nodeCount)}-node sample has ${String(sample.runs.length)} recorded runs; expected 3.`,
        );
      }
    }
  }
  const expected = new Set<string>(expectedCandidates);
  for (const candidate of input) {
    if (!expected.has(candidate.candidate)) {
      errors.push(`Unexpected candidate ${candidate.candidate}.`);
    }
  }
  return errors;
}

function normalizedJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function checkCanvasEvidence(): Promise<void> {
  const [resultsRaw, environmentRaw, adr, currentLicenses] = await Promise.all([
    readFile(resultsPath, "utf8"),
    readFile(environmentPath, "utf8"),
    readFile(adrPath, "utf8"),
    collectCanvasLicenses(),
  ]);
  const results = JSON.parse(resultsRaw) as StoredResults;
  const environment = JSON.parse(environmentRaw) as Record<string, unknown>;
  const errors = validateBenchmarkMatrix(results.candidates);

  if (resultsRaw !== normalizedJson(results)) errors.push("results.json is not canonical JSON.");
  if (environmentRaw !== normalizedJson(environment)) {
    errors.push("environment.json is not canonical JSON.");
  }
  if (results.schemaVersion !== 1) errors.push("results.json schemaVersion must be 1.");
  if (environment["schemaVersion"] !== 1) {
    errors.push("environment.json schemaVersion must be 1.");
  }
  if (environment["capturedAt"] !== results.generatedAt) {
    errors.push("Benchmark and environment timestamps do not match.");
  }
  if (
    results.protocol.warmupRuns !== 1 ||
    results.protocol.recordedRuns !== 3 ||
    !sameValue(results.protocol.nodeCounts, expectedNodeCounts)
  ) {
    errors.push("Benchmark protocol does not match one warm-up and three recorded runs.");
  }

  for (const candidate of results.candidates) {
    const license = currentLicenses.find((entry) => entry.packageName === candidate.candidate);
    if (license === undefined || !sameValue(license, candidate.license)) {
      errors.push(`${candidate.candidate} license evidence has drifted.`);
    }
    if (candidate.packageVersion !== candidate.license.version) {
      errors.push(`${candidate.candidate} package version and license evidence disagree.`);
    }
    for (const sample of candidate.samples) {
      const summary = summarizeRuns(sample.runs);
      if (
        sample.successfulRuns !== summary.successfulRuns ||
        sample.failedRuns !== summary.failedRuns ||
        !sameValue(sample.medians, summary.medians) ||
        sample.medianFirstUsableMs !== summary.medians.firstUsableMs ||
        sample.medianHeapAfterMount !== summary.medians.heapAfterMount
      ) {
        errors.push(
          `${candidate.candidate} ${String(sample.nodeCount)}-node summary does not match its runs.`,
        );
      }
    }
  }

  const expectedAdr = renderCanvasAdrContent(results, environment);
  if (adr !== expectedAdr) errors.push("Canvas ADR is out of date.");
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write("Canvas evidence is complete, canonical, and internally consistent.\n");
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await checkCanvasEvidence();
}
