import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const longRunningServices = [
  "web",
  "api",
  "worker",
  "postgres",
  "redis",
  "minio",
  "mailpit",
] as const;

export interface ComposeServiceStatus {
  Service: string;
  State: string;
  Health: string;
  ExitCode: number;
  Name?: string;
}

export function evaluateComposeServices(services: ComposeServiceStatus[]): string[] {
  const byName = new Map(services.map((service) => [service.Service, service]));
  const problems: string[] = [];
  for (const serviceName of longRunningServices) {
    const service = byName.get(serviceName);
    if (service === undefined) {
      problems.push(`${serviceName} is missing`);
    } else if (service.State !== "running") {
      problems.push(`${serviceName} is ${service.State}, expected running`);
    } else if (service.Health !== "healthy") {
      problems.push(`${serviceName} is running but ${service.Health || "has no health status"}`);
    }
  }
  const initializer = byName.get("minio-init");
  if (initializer === undefined) {
    problems.push("minio-init is missing");
  } else if (initializer.State !== "exited") {
    problems.push(`minio-init is ${initializer.State}, expected exited`);
  } else if (initializer.ExitCode !== 0) {
    problems.push(`minio-init exited with code ${String(initializer.ExitCode)}`);
  }
  return problems;
}

function parseComposeStatuses(output: string): ComposeServiceStatus[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split("\n").map((line) => JSON.parse(line) as ComposeServiceStatus);
}

async function readComposeStatuses(): Promise<ComposeServiceStatus[]> {
  const { stdout } = await execFileAsync("docker", [
    "compose",
    "--env-file",
    ".env.example",
    "ps",
    "--all",
    "--format",
    "json",
  ]);
  return parseComposeStatuses(stdout);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForCompose(timeoutMs: number): Promise<ComposeServiceStatus[]> {
  const deadline = Date.now() + timeoutMs;
  let latest = await readComposeStatuses();
  while (evaluateComposeServices(latest).length > 0 && Date.now() < deadline) {
    await delay(1_000);
    latest = await readComposeStatuses();
  }
  if (evaluateComposeServices(latest).length === 0) return latest;
  throw new Error(`Compose did not become healthy: ${evaluateComposeServices(latest).join("; ")}`);
}

async function assertEndpoint(url: string, expectedComponents: string[]): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${String(response.status)}`);
  const body = (await response.json()) as {
    status?: unknown;
    components?: Record<string, unknown>;
  };
  if (body.status !== "ok") throw new Error(`${url} did not report status ok`);
  for (const component of expectedComponents) {
    if (body.components?.[component] !== "ok") {
      throw new Error(`${url} did not report ${component} as ok`);
    }
  }
}

export async function verifyComposeHealth(timeoutMs = 120_000): Promise<ComposeServiceStatus[]> {
  const services = await waitForCompose(timeoutMs);
  await assertEndpoint("http://127.0.0.1:8080/health", []);
  await assertEndpoint("http://127.0.0.1:3000/health/ready", [
    "postgres",
    "redis",
    "minio",
    "smtp",
  ]);
  await assertEndpoint("http://127.0.0.1:3001/health/ready", [
    "postgres",
    "redis",
    "minio",
    "queue",
  ]);
  return services;
}

async function main(): Promise<void> {
  const services = await verifyComposeHealth();
  for (const service of services.sort((left, right) => left.Service.localeCompare(right.Service))) {
    const state = service.Service === "minio-init" ? "completed" : service.Health;
    console.log(`${service.Service}: ${state}`);
  }
  console.log("web: http://127.0.0.1:8080");
  console.log("api: http://127.0.0.1:3000/health/ready");
  console.log("worker: http://127.0.0.1:3001/health/ready");
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Compose health verification failed");
    process.exitCode = 1;
  }
}
