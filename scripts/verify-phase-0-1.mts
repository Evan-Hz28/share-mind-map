import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const reportPath = "docs/verification/phase-0-1-2026-09-16.md";

export const requiredEvidence = [
  "README.md",
  "packages/document-model/schema/cloud-document-v1.schema.json",
  "packages/api-client/openapi.json",
  "packages/api-client/src/generated/sdk.gen.ts",
  "docs/adr/0001-canvas-component.md",
  "docs/benchmarks/canvas/environment.json",
  "docs/benchmarks/canvas/results.json",
  "tests/fixtures/xmind/manifest.json",
  "tests/fixtures/xmind/nodes-5000.xmind",
  "tests/fixtures/xmind/nodes-20000.xmind",
  "apps/api/Dockerfile",
  "apps/worker/Dockerfile",
  "apps/web/Dockerfile",
  "infra/nginx/default.conf",
  "docs/verification/screenshots/login-chromium.png",
  "docs/verification/screenshots/workspace-chromium.png",
  "docs/verification/screenshots/members-chromium.png",
  "docs/verification/screenshots/login-mobile-chrome.png",
  "docs/verification/screenshots/workspace-mobile-chrome.png",
  "docs/verification/screenshots/members-mobile-chrome.png",
  ...Array.from(
    { length: 12 },
    (_, index) => `.superpowers/sdd/2026-09-16-phase-0-1/task-${String(index + 1)}-report.md`,
  ),
] as const;

interface Probe {
  name: string;
  command: string;
  args: string[];
}

interface ProbeResult extends Probe {
  durationMs: number;
  passed: boolean;
}

interface ComposeStatus {
  Service: string;
  Image: string;
  State: string;
  Health: string;
  ID: string;
  Name: string;
  ExitCode: number;
}

interface RuntimeStatus extends ComposeStatus {
  pid: number;
}

const probes: Probe[] = [
  {
    name: "Compose structure",
    command: "pnpm",
    args: ["test:compose-structure"],
  },
  { name: "Compose health", command: "pnpm", args: ["compose:health"] },
  {
    name: "Document Schema drift",
    command: "pnpm",
    args: ["--filter", "@share-mind-map/document-model", "check:schema"],
  },
  { name: "OpenAPI/client drift", command: "pnpm", args: ["api:check"] },
  { name: "XMind fixture drift", command: "pnpm", args: ["check:xmind-fixtures"] },
  { name: "Independent worker fixtures", command: "pnpm", args: ["verify:xmind-worker"] },
  { name: "Canvas evidence", command: "pnpm", args: ["canvas:check"] },
  { name: "Whitespace integrity", command: "git", args: ["diff", "--check"] },
];

export async function findMissingEvidence(
  paths: readonly string[],
  exists: (path: string) => Promise<boolean> = async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
): Promise<string[]> {
  const results = await Promise.all(
    paths.map(async (path) => ({ path, exists: await exists(path) })),
  );
  return results.filter((result) => !result.exists).map((result) => result.path);
}

export function completionVerdict(
  missingEvidence: readonly string[],
  failedProbes: readonly string[],
): "PASS" | "INCOMPLETE" {
  return missingEvidence.length === 0 && failedProbes.length === 0 ? "PASS" : "INCOMPLETE";
}

async function run(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

async function runProbe(probe: Probe): Promise<ProbeResult> {
  const startedAt = performance.now();
  try {
    await run(probe.command, probe.args);
    return { ...probe, durationMs: Math.round(performance.now() - startedAt), passed: true };
  } catch {
    return { ...probe, durationMs: Math.round(performance.now() - startedAt), passed: false };
  }
}

async function toolVersions(): Promise<Record<string, string>> {
  return {
    Node: process.version,
    pnpm: await run("pnpm", ["--version"]),
    Docker: await run("docker", ["--version"]),
    "Docker Compose": await run("docker", ["compose", "version", "--short"]),
  };
}

async function runtimeStatuses(): Promise<RuntimeStatus[]> {
  const output = await run("docker", [
    "compose",
    "--env-file",
    ".env.example",
    "ps",
    "--all",
    "--format",
    "json",
  ]);
  if (output.length === 0) return [];
  const statuses = output.split("\n").map((line) => JSON.parse(line) as ComposeStatus);
  const withPids: RuntimeStatus[] = [];
  for (const status of statuses) {
    const rawPid = await run("docker", ["inspect", "--format", "{{.State.Pid}}", status.ID]);
    withPids.push({ ...status, pid: Number(rawPid) });
  }
  return withPids.sort((left, right) => left.Service.localeCompare(right.Service));
}

function commandText(probe: Probe): string {
  return [probe.command, ...probe.args].join(" ");
}

export function renderReport(input: {
  generatedAt: string;
  verdict: "PASS" | "INCOMPLETE";
  missingEvidence: string[];
  failedProbes: string[];
  versions: Record<string, string>;
  runtime: RuntimeStatus[];
  results: ProbeResult[];
}): string {
  const requirementStatus = input.verdict;
  const lines = [
    "# Phase 0-1 Verification Report",
    "",
    `- Generated: ${input.generatedAt}`,
    `- Local acceptance verdict: **${input.verdict}**`,
    "- Production release verdict: **NOT ASSESSED** (phase 6 external gates remain open)",
    "",
    "## Tool Versions",
    "",
    "| Tool | Version |",
    "|---|---|",
    ...Object.entries(input.versions).map(([name, version]) => `| ${name} | ${version} |`),
    "",
    "## Runtime",
    "",
    "| Service | Image | State | Health | PID |",
    "|---|---|---|---|---:|",
    ...input.runtime.map(
      (service) =>
        `| ${service.Service} | ${service.Image} | ${service.State} | ${service.Health || (service.ExitCode === 0 ? "completed" : "failed")} | ${String(service.pid)} |`,
    ),
    "",
    "## Verification Probes",
    "",
    "| Probe | Command | Result | Duration (ms) |",
    "|---|---|---|---:|",
    ...input.results.map(
      (result) =>
        `| ${result.name} | \`${commandText(result)}\` | ${result.passed ? "PASS" : "FAIL"} | ${String(result.durationMs)} |`,
    ),
    "",
    "## Requirement Evidence",
    "",
    "| Requirement | Evidence | Status |",
    "|---|---|---|",
    `| Canvas-independent Schema V1 | document-model tests, generated JSON Schema, Task 2 report | ${requirementStatus} |`,
    `| OpenAPI-generated client | OpenAPI/client drift probe, generated contract tests, Task 10 report | ${requirementStatus} |`,
    `| Canvas decision | ADR 0001, raw environment/results, canvas evidence probe, Task 5 report | ${requirementStatus} |`,
    `| XMind safety and scale | synthetic manifest, archive tests, 5k/20k fixtures, fixture probes, Tasks 3-4 reports | ${requirementStatus} |`,
    `| Independent Worker | separate image/PID, Worker readiness and queue component, Task 4 report | ${requirementStatus} |`,
    `| Complete local runtime | Compose structure/health probes and runtime table | ${requirementStatus} |`,
    `| Authentication and member lifecycle | API integration evidence in Tasks 8-9; Chromium E2E and screenshots | ${requirementStatus} |`,
    `| Reader/Editor/Admin authorization | server integration matrix and Chromium route/API matrix | ${requirementStatus} |`,
    `| Empty/repeated migrations | migration integration evidence in Task 6; API startup entrypoint | ${requirementStatus} |`,
    `| Interactive bootstrap/recovery | command integration evidence in Task 9 and real-container E2E | ${requirementStatus} |`,
    `| Responsive UI | desktop/mobile login, workspace, members screenshots and layout assertions | ${requirementStatus} |`,
    `| Documentation and quality | README, Tasks 1-12 reports, verification probes | ${requirementStatus} |`,
    "",
    "## External Phase 6 Gates",
    "",
    "| Gate | Status |",
    "|---|---|",
    "| Representative business XMind corpus | UNVERIFIED |",
    "| Real SMTP and production object storage | UNVERIFIED |",
    "| Production-like capacity, longevity, and fault injection | UNVERIFIED |",
    "| Real Chrome/Edge compatibility matrix and Pilot approval | UNVERIFIED |",
    "| Backup/restore and RPO/RTO exercise | UNVERIFIED |",
    "| TLS, monitoring, security scan, rotation, and rollback exercise | UNVERIFIED |",
    "",
    "## Scope Boundary",
    "",
    "Phase 2-6 document CRUD/import, editing, assets, sharing, comments, notifications, trash, test execution, realtime collaboration, conflict handling, and production deployment remain unimplemented.",
    "",
    "## Missing Or Failed Evidence",
    "",
    ...(input.missingEvidence.length === 0
      ? ["- Missing artifacts: none"]
      : input.missingEvidence.map((path) => `- Missing artifact: \`${path}\``)),
    ...(input.failedProbes.length === 0
      ? ["- Failed probes: none"]
      : input.failedProbes.map((probe) => `- Failed probe: ${probe}`)),
  ];
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const missingEvidence = await findMissingEvidence(requiredEvidence);
  const versions = await toolVersions();
  const runtime = await runtimeStatuses();
  const results: ProbeResult[] = [];
  for (const probe of probes) results.push(await runProbe(probe));
  const failedProbes = results.filter((result) => !result.passed).map((result) => result.name);
  const verdict = completionVerdict(missingEvidence, failedProbes);
  await mkdir("docs/verification", { recursive: true });
  await writeFile(
    reportPath,
    renderReport({
      generatedAt: new Date().toISOString(),
      verdict,
      missingEvidence,
      failedProbes,
      versions,
      runtime,
      results,
    }),
    "utf8",
  );
  console.log(`Phase 0-1 verification: ${verdict}`);
  console.log(`Report: ${reportPath}`);
  if (verdict !== "PASS") process.exitCode = 1;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  await main();
}
