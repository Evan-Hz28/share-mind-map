import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ComposePort {
  host_ip?: string;
  published?: string | number;
  target?: string | number;
}

export interface ComposeService {
  build?: { context?: string; dockerfile?: string } | string;
  depends_on?: Record<string, { condition?: string }> | string[];
  entrypoint?: string[];
  healthcheck?: { test?: string[] };
  ports?: ComposePort[];
  volumes?: Array<string | { source?: string; target?: string }>;
}

export interface ComposeConfiguration {
  services: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
}

export async function composeConfig(envFile = ".env.example"): Promise<ComposeConfiguration> {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "--env-file", envFile, "config", "--format", "json"],
    { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as ComposeConfiguration;
}

export function hostBindings(service: ComposeService | undefined): ComposePort[] {
  return service?.ports ?? [];
}

export function dependencyCondition(
  service: ComposeService | undefined,
  dependency: string,
): string | undefined {
  if (service?.depends_on === undefined || Array.isArray(service.depends_on)) return undefined;
  return service.depends_on[dependency]?.condition;
}
