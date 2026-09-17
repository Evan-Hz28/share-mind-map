import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { collectLicenseEvidence } from "../../../../scripts/canvas-license-check.mjs";
import { median, summarizeRuns } from "../../../../scripts/canvas-benchmark.mjs";
import { validateBenchmarkMatrix } from "../../../../scripts/check-canvas-evidence.mjs";
import {
  evaluateCanvasDecision,
  type CanvasDecisionInput,
} from "../../../../scripts/render-canvas-adr.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("canvas license evidence", () => {
  it("hashes bundled license text from the installed package", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "canvas-license-present-"));
    temporaryDirectories.push(packageDirectory);
    await writeFile(
      join(packageDirectory, "package.json"),
      `${JSON.stringify({ name: "candidate", version: "1.2.3", license: "MIT" })}\n`,
    );
    await writeFile(join(packageDirectory, "LICENSE"), "fixture license\n");

    const evidence = await collectLicenseEvidence("candidate", packageDirectory);

    expect(evidence).toMatchObject({
      packageName: "candidate",
      version: "1.2.3",
      spdx: "MIT",
      compatible: true,
    });
    expect(evidence.licenseFiles).toEqual([
      {
        path: "LICENSE",
        sha256: "a7c6bf8df7d8fb707af606599f275e0eb192cd28492c95593b0608ca966c8df1",
      },
    ]);
  });

  it("rejects a package without bundled license evidence", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "canvas-license-missing-"));
    temporaryDirectories.push(packageDirectory);
    await writeFile(
      join(packageDirectory, "package.json"),
      `${JSON.stringify({ name: "candidate", version: "1.2.3", license: "MIT" })}\n`,
    );

    await expect(collectLicenseEvidence("candidate", packageDirectory)).resolves.toMatchObject({
      compatible: false,
      licenseFiles: [],
      conclusion: "missing-bundled-license",
    });
  });
});

describe("canvas ADR decision", () => {
  it("selects the fastest fully passing candidate", () => {
    const input = decisionInput();
    input.candidates.push(passingCandidate("mind-elixir", 2_200, 4_100, 90_000_000));
    input.candidates.push(passingCandidate("simple-mind-map", 2_400, 4_500, 80_000_000));

    expect(evaluateCanvasDecision(input)).toEqual({
      decision: "selected",
      selectedCandidate: "mind-elixir",
      passingCandidates: ["mind-elixir", "simple-mind-map"],
      rejectedCandidates: [],
    });
  });

  it("returns no-selection when every candidate misses a required gate", () => {
    const input = decisionInput();
    const missingLicense = passingCandidate("simple-mind-map", 2_000, 4_000, 70_000_000);
    missingLicense.licenseCompatible = false;
    const slow = passingCandidate("mind-elixir", 3_200, 5_100, 80_000_000);
    const missingCapability = passingCandidate("jsmind", 1_500, 3_000, 60_000_000);
    missingCapability.capabilities.undoHook = false;
    input.candidates.push(missingLicense, slow, missingCapability);

    expect(evaluateCanvasDecision(input)).toEqual({
      decision: "no-selection",
      selectedCandidate: null,
      passingCandidates: [],
      rejectedCandidates: [
        { candidate: "jsmind", failedGates: ["capability:undoHook"] },
        { candidate: "mind-elixir", failedGates: ["performance:5000", "performance:20000"] },
        { candidate: "simple-mind-map", failedGates: ["license"] },
      ],
    });
  });
});

describe("canvas benchmark aggregation", () => {
  it("uses the median of three recorded runs without mutating their order", () => {
    const values = [300, 100, 200];
    expect(median(values)).toBe(200);
    expect(values).toEqual([300, 100, 200]);
  });

  it("keeps failed runs explicit when no measurement succeeds", () => {
    expect(
      summarizeRuns([
        { status: "failed", error: "timeout" },
        { status: "failed", error: "page-crashed" },
        { status: "failed", error: "timeout" },
      ]),
    ).toEqual({
      successfulRuns: 0,
      failedRuns: 3,
      medians: {
        mountMs: null,
        firstUsableMs: null,
        replacementMs: null,
        interactionMs: null,
        heapAfterMount: null,
        heapAfterDestroy: null,
      },
    });
  });

  it("requires every candidate and sample even when runs fail", () => {
    const matrix = ["simple-mind-map", "mind-elixir", "jsmind"].map((candidate) => ({
      candidate,
      samples: [100, 5_000, 20_000].map((nodeCount) => ({
        nodeCount,
        runs: [{ status: "failed" }, { status: "failed" }, { status: "failed" }],
      })),
    }));
    expect(validateBenchmarkMatrix(matrix)).toEqual([]);

    matrix[1]?.samples.pop();
    expect(validateBenchmarkMatrix(matrix)).toEqual([
      "mind-elixir is missing the 20000-node sample.",
    ]);
  });
});

function decisionInput(): CanvasDecisionInput {
  return { candidates: [] };
}

function passingCandidate(
  candidate: "simple-mind-map" | "mind-elixir" | "jsmind",
  fiveThousandMs: number,
  twentyThousandMs: number,
  heapBytes: number,
): CanvasDecisionInput["candidates"][number] {
  return {
    candidate,
    licenseCompatible: true,
    externalCloudRequests: [],
    capabilities: {
      readOnly: true,
      stableIds: true,
      createDelete: true,
      reparenting: true,
      reordering: true,
      collapse: true,
      keyboardHooks: true,
      zoomPan: true,
      undoHook: true,
      image: true,
      label: true,
      icon: true,
      basicStyle: true,
      snapshotReplacement: true,
      stateRestoration: true,
      deterministicExport: true,
      cleanup: true,
      noCloudDependency: true,
    },
    samples: [
      { nodeCount: 5_000, medianFirstUsableMs: fiveThousandMs, medianHeapAfterMount: heapBytes },
      { nodeCount: 20_000, medianFirstUsableMs: twentyThousandMs, medianHeapAfterMount: heapBytes },
    ],
  };
}
