import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import { ApiTestRepository, type Database } from "@share-mind-map/database";
import { z } from "zod";

import type { WorkerConfig } from "../config.js";

export interface ApiTestRunJob {
  runId: string;
}

const STDERR_LIMIT = 8 * 1024;

const exchangeSchema = z
  .object({
    method: z.string(),
    url: z.string(),
    status: z.number().optional(),
    durationMs: z.number().optional(),
    requestHeaders: z.record(z.string(), z.string()).optional(),
    requestQuery: z.unknown().optional(),
    requestBody: z.unknown().optional(),
    responseBody: z.unknown().optional(),
    error: z.string().optional(),
  })
  .loose();

const eventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("collection"), count: z.number() }),
  z.object({
    event: z.literal("start"),
    node_id: z.string(),
    case_name: z.string(),
    ordinal: z.number(),
  }),
  z.object({
    event: z.literal("result"),
    node_id: z.string(),
    case_name: z.string(),
    ordinal: z.number(),
    status: z.enum(["passed", "failed", "skipped", "error"]),
    duration_ms: z.number(),
    failure: z.string().optional(),
    exchanges: z.array(exchangeSchema).optional(),
  }),
  z.object({
    event: z.literal("finish"),
    exit_status: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    error: z.number(),
  }),
]);

type Exchange = z.infer<typeof exchangeSchema>;

function exchangesToColumns(exchanges: Exchange[]): {
  request: unknown;
  response: unknown;
} {
  return {
    request: exchanges.map((exchange) => ({
      method: exchange.method,
      url: exchange.url,
      headers: exchange.requestHeaders ?? {},
      query: exchange.requestQuery ?? null,
      body: exchange.requestBody ?? null,
      error: exchange.error ?? null,
    })),
    response: exchanges.map((exchange) => ({
      status: exchange.status ?? null,
      durationMs: exchange.durationMs ?? null,
      body: exchange.responseBody ?? null,
      error: exchange.error ?? null,
    })),
  };
}

function allowedHosts(config: WorkerConfig, baseUrl: string): boolean {
  if (!URL.canParse(baseUrl)) return false;
  const host = new URL(baseUrl).hostname;
  return config.apiTestAllowedHosts.includes(host);
}

function suiteDirectory(config: WorkerConfig, path: string): string | null {
  if (path.startsWith("/") || path.includes("..")) return null;
  const root = resolve(config.apiTestRoot);
  const directory = resolve(root, path);
  return directory.startsWith(`${root}${sep}`) ? directory : null;
}

/** 直接读 .git/HEAD，避免为一次只读操作再 fork 一个 git 进程。 */
async function currentCommit(root: string): Promise<string | null> {
  try {
    const head = (await readFile(join(root, ".git", "HEAD"), "utf8")).trim();
    if (!head.startsWith("ref: ")) return head === "" ? null : head;
    const ref = await readFile(join(root, ".git", head.slice(5).trim()), "utf8");
    return ref.trim() === "" ? null : ref.trim();
  } catch {
    return null;
  }
}

export async function processApiTestRun(
  job: ApiTestRunJob,
  dependencies: { database: Database; config: WorkerConfig },
): Promise<void> {
  const { database, config } = dependencies;
  const repository = new ApiTestRepository();
  const run = await repository.findRun(database, job.runId);
  if (run === null) return;
  if (run.status === "cancelled") return;

  const directory = suiteDirectory(config, run.suitePath);
  if (directory === null) {
    await repository.finishRun(database, run.id, "failed", "套件路径不合法。");
    return;
  }
  if (!allowedHosts(config, run.environmentBaseUrl)) {
    await repository.finishRun(database, run.id, "failed", "测试环境域名不在允许列表内。");
    return;
  }
  // 用例仓库靠同步任务维护，没同步过就跑只会得到满屏收集错误。
  const repositoryReady = await access(join(config.apiTestRoot, "testcases")).then(
    () => true,
    () => false,
  );
  if (!repositoryReady) {
    await repository.finishRun(
      database,
      run.id,
      "failed",
      "用例仓库尚未同步，请先在「接口测试」页执行一次同步。",
    );
    return;
  }
  if (!(await repository.markRunning(database, run.id))) return;
  await repository.setRunRepoCommit(database, run.id, await currentCommit(config.apiTestRoot));

  const child = spawn(
    config.apiTestPython,
    [
      "-m",
      "pytest",
      run.suitePath,
      "-q",
      `--timeout=${String(config.apiTestCaseTimeoutSeconds)}`,
      "-p",
      "harness.pytest_platform",
      "-o",
      "addopts=",
      "-o",
      "log_cli=false",
    ],
    {
      cwd: config.apiTestRoot,
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME ?? "/home/node",
        LANG: "C.UTF-8",
        TMPDIR: "/tmp",
        PYTHONUNBUFFERED: "1",
        PYTHONDONTWRITEBYTECODE: "1",
        // harness 在镜像里，common/config 在仓库里，两边都要能 import。
        PYTHONPATH: `${config.apiTestHarnessRoot}:${config.apiTestRoot}`,
        ENV: "test",
        BASE_URL: run.environmentBaseUrl,
        API_BASE_URL: run.environmentBaseUrl,
        AUTH_METHOD: config.authMethod,
        AUTH_PHONE: config.authPhone,
        AUTH_SMS_CODE: config.authSmsCode,
        API_TEST_CAPTURE: config.apiTestCapture,
        API_TEST_ALLOWED_HOSTS: config.apiTestAllowedHosts.join(","),
        ...(config.apiToken === undefined ? {} : { API_TOKEN: config.apiToken }),
        ...(config.imUsername === undefined ? {} : { IM_USERNAME: config.imUsername }),
        ...(config.imPassword === undefined ? {} : { IM_PASSWORD: config.imPassword }),
      },
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    },
  );

  let stderr = "";
  const finishCounts = { failed: 0, error: 0 };
  const seen = new Set<string>();
  const pending: Promise<void>[] = [];

  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT);
  });

  const eventStream = child.stdio[3] as Readable | null;
  if (eventStream !== null) {
    const lines = createInterface({ input: eventStream });
    lines.on("line", (line) => {
      if (line.trim() === "") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        return;
      }
      const result = eventSchema.safeParse(parsed);
      if (!result.success) return;
      const event = result.data;
      if (event.event === "finish") {
        finishCounts.failed = event.failed;
        finishCounts.error = event.error;
        return;
      }
      if (event.event !== "result") return;
      if (seen.has(event.node_id)) return;
      seen.add(event.node_id);
      const columns = exchangesToColumns(event.exchanges ?? []);
      pending.push(
        repository
          .insertItem(database, {
            runId: run.id,
            nodeId: event.node_id,
            caseName: event.case_name,
            ordinal: event.ordinal,
            status: event.status,
            durationMs: Math.round(event.duration_ms),
            failure: event.failure ?? null,
            request: columns.request,
            response: columns.response,
          })
          .catch(() => undefined),
      );
    });
  }

  let cancelled = false;
  const cancelPoll = setInterval(() => {
    void repository
      .isCancelRequested(database, run.id)
      .then((requested) => {
        if (!requested || cancelled) return;
        cancelled = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, 5_000);
      })
      .catch(() => undefined);
  }, 1_000);

  const runTimeoutMs = config.apiTestRunTimeoutSeconds * 1000;
  const hardTimeout = setTimeout(() => {
    stderr = `${stderr}\n执行超过 ${String(config.apiTestRunTimeoutSeconds)} 秒，已强制结束。`.slice(
      -STDERR_LIMIT,
    );
    child.kill("SIGKILL");
  }, runTimeoutMs);

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit) => {
      child.once("error", (error) => {
        stderr = `${stderr}\n${error.message}`.slice(-STDERR_LIMIT);
        resolveExit({ code: null, signal: null });
      });
      child.once("close", (code, signal) => {
        resolveExit({ code, signal });
      });
    },
  );
  clearInterval(cancelPoll);
  clearTimeout(hardTimeout);

  await Promise.allSettled(pending);

  if (await repository.isCancelRequested(database, run.id)) {
    await repository.markCancelled(database, run.id);
    return;
  }
  const failed = finishCounts.failed;
  const errored = finishCounts.error;
  const succeeded = exit.code === 0 && failed === 0 && errored === 0;
  const message = succeeded
    ? null
    : stderr.trim() === ""
      ? `pytest 退出码 ${String(exit.code ?? "null")}`
      : stderr.trim();
  await repository.finishRun(database, run.id, succeeded ? "succeeded" : "failed", message);
}
