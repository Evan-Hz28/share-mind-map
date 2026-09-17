import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { CanvasCapabilities, CanvasCandidate } from "../apps/web/src/poc/types.js";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultsPath = resolve(rootDirectory, "docs/benchmarks/canvas/results.json");
const environmentPath = resolve(rootDirectory, "docs/benchmarks/canvas/environment.json");
const adrPath = resolve(rootDirectory, "docs/adr/0001-canvas-component.md");

const requiredCapabilities: (keyof CanvasCapabilities)[] = [
  "readOnly",
  "stableIds",
  "createDelete",
  "reparenting",
  "reordering",
  "collapse",
  "keyboardHooks",
  "zoomPan",
  "undoHook",
  "image",
  "label",
  "icon",
  "basicStyle",
  "snapshotReplacement",
  "stateRestoration",
  "deterministicExport",
  "cleanup",
  "noCloudDependency",
];

export type CanvasDecisionCandidate = {
  candidate: CanvasCandidate;
  licenseCompatible: boolean;
  externalCloudRequests: string[];
  capabilities: CanvasCapabilities;
  samples: {
    nodeCount: number;
    medianFirstUsableMs: number | null;
    medianHeapAfterMount: number | null;
  }[];
};

export type CanvasDecisionInput = { candidates: CanvasDecisionCandidate[] };

export type CanvasDecision = {
  decision: "selected" | "no-selection";
  selectedCandidate: CanvasCandidate | null;
  passingCandidates: CanvasCandidate[];
  rejectedCandidates: { candidate: CanvasCandidate; failedGates: string[] }[];
};

function sample(candidate: CanvasDecisionCandidate, nodeCount: number) {
  return candidate.samples.find((entry) => entry.nodeCount === nodeCount);
}

function failedGates(candidate: CanvasDecisionCandidate): string[] {
  const failures: string[] = [];
  if (!candidate.licenseCompatible) failures.push("license");
  if (candidate.externalCloudRequests.length > 0 || !candidate.capabilities.noCloudDependency) {
    failures.push("cloud-dependency");
  }
  for (const capability of requiredCapabilities) {
    if (!candidate.capabilities[capability]) failures.push(`capability:${capability}`);
  }
  const fiveThousand = sample(candidate, 5_000)?.medianFirstUsableMs;
  if (fiveThousand === undefined || fiveThousand === null || fiveThousand > 3_000) {
    failures.push("performance:5000");
  }
  const twentyThousand = sample(candidate, 20_000)?.medianFirstUsableMs;
  if (twentyThousand === undefined || twentyThousand === null || twentyThousand > 5_000) {
    failures.push("performance:20000");
  }
  return failures;
}

export function evaluateCanvasDecision(input: CanvasDecisionInput): CanvasDecision {
  const evaluations = input.candidates.map((candidate) => ({
    candidate,
    failedGates: failedGates(candidate),
  }));
  const passing = evaluations
    .filter((entry) => entry.failedGates.length === 0)
    .map((entry) => entry.candidate)
    .sort((left, right) => {
      const capabilityDifference =
        requiredCapabilities.filter((capability) => right.capabilities[capability]).length -
        requiredCapabilities.filter((capability) => left.capabilities[capability]).length;
      if (capabilityDifference !== 0) return capabilityDifference;
      const timeDifference =
        (sample(left, 20_000)?.medianFirstUsableMs ?? Number.POSITIVE_INFINITY) -
        (sample(right, 20_000)?.medianFirstUsableMs ?? Number.POSITIVE_INFINITY);
      if (timeDifference !== 0) return timeDifference;
      const heapDifference =
        (sample(left, 20_000)?.medianHeapAfterMount ?? Number.POSITIVE_INFINITY) -
        (sample(right, 20_000)?.medianHeapAfterMount ?? Number.POSITIVE_INFINITY);
      if (heapDifference !== 0) return heapDifference;
      return left.candidate.localeCompare(right.candidate);
    });
  const rejectedCandidates = evaluations
    .filter((entry) => entry.failedGates.length > 0)
    .map((entry) => ({ candidate: entry.candidate.candidate, failedGates: entry.failedGates }))
    .sort((left, right) => left.candidate.localeCompare(right.candidate));

  return {
    decision: passing.length > 0 ? "selected" : "no-selection",
    selectedCandidate: passing[0]?.candidate ?? null,
    passingCandidates: passing.map((candidate) => candidate.candidate),
    rejectedCandidates,
  };
}

export type CanvasResults = CanvasDecisionInput & { generatedAt: string; schemaVersion: number };

export function renderCanvasAdrContent(
  results: CanvasResults,
  environment: Record<string, unknown>,
): string {
  const decision = evaluateCanvasDecision(results);
  const selected = decision.selectedCandidate ?? "no-selection";
  const rows = results.candidates
    .map((candidate) => {
      const fiveThousand = sample(candidate, 5_000)?.medianFirstUsableMs;
      const twentyThousand = sample(candidate, 20_000)?.medianFirstUsableMs;
      const rejection = decision.rejectedCandidates.find(
        (entry) => entry.candidate === candidate.candidate,
      );
      const fiveThousandDisplay = fiveThousand === undefined ? "failed" : String(fiveThousand);
      const twentyThousandDisplay =
        twentyThousand === undefined ? "failed" : String(twentyThousand);
      return `| ${candidate.candidate} | ${candidate.licenseCompatible ? "pass" : "fail"} | ${fiveThousandDisplay} | ${twentyThousandDisplay} | ${rejection?.failedGates.join(", ") ?? "pass"} |`;
    })
    .join("\n");
  return `# ADR 0001: Canvas component\n\n- Status: Accepted\n- Decision: ${selected}\n- Evidence date: ${results.generatedAt}\n\n## Context\n\nThree installed browser canvas packages were evaluated through the same CloudDocumentV1 adapter using synthetic 100, 5,000, and 20,000 node samples. Raw measurements are in \`docs/benchmarks/canvas/results.json\`; the captured machine and browser context is in \`docs/benchmarks/canvas/environment.json\`.\n\n## Decision\n\nDecision: ${selected}\n\n${decision.decision === "no-selection" ? "No candidate passed every approved gate. Phase 4 scope and performance requirements must be reviewed before selecting a production canvas." : `Use ${selected} for the phase 4 canvas boundary, subject to validation with representative business documents.`}\n\n## Evidence\n\n| Candidate | License | 5,000 first usable median (ms) | 20,000 first usable median (ms) | Gate result |\n|---|---:|---:|---:|---|\n${rows}\n\nEnvironment summary: ${JSON.stringify(environment)}\n\n## Known Gaps\n\n- Samples are deterministic and synthetic; they are not representative company documents.\n- Measurements describe this recorded Chromium and machine only, not production acceptance.\n- Image behavior is capability-probed without production object storage integration.\n- External cloud traffic is rejected; no candidate may depend on an external service for core rendering.\n`;
}

export async function renderCanvasAdr(): Promise<string> {
  const [results, environment] = await Promise.all([
    readFile(resultsPath, "utf8").then((value) => JSON.parse(value) as CanvasResults),
    readFile(environmentPath, "utf8").then((value) => JSON.parse(value) as Record<string, unknown>),
  ]);
  const content = renderCanvasAdrContent(results, environment);
  await mkdir(dirname(adrPath), { recursive: true });
  await writeFile(adrPath, content, "utf8");
  return content;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await renderCanvasAdr();
  process.stdout.write(`${adrPath}\n`);
}
