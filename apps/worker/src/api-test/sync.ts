import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ApiTestRepository, newId, type Database } from "@share-mind-map/database";

import type { WorkerConfig } from "../config.js";

export interface ApiTestSyncJob {
  syncId: string;
}

const GIT_TIMEOUT_MS = 5 * 60 * 1000;
const MESSAGE_LIMIT = 4 * 1024;
// 6000+ 条 NDJSON 大约 1 MB，留足余量；超过上限说明扫描结果异常，宁可放弃本轮编目。
const CASE_SCAN_TIMEOUT_MS = 2 * 60 * 1000;
const CASE_OUTPUT_LIMIT = 8 * 1024 * 1024;

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface CollectedCase {
  file_path: string;
  node_id: string;
  name: string;
  kind: "file" | "case";
  ordinal: number;
}

/** 同步只做 fetch + reset，工作副本是一次性的，所以永远不接受本地改动。 */
function run(command: string, args: string[], options: { cwd?: string } = {}):
  Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME ?? "/home/node",
        LANG: "C.UTF-8",
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), GIT_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** token 只出现在子进程的参数里，日志和数据库里都保留脱敏后的地址。 */
function remoteUrl(config: WorkerConfig): { url: string; redacted: string } {
  if (config.apiTestGitToken === undefined) {
    return { url: config.apiTestGitUrl, redacted: config.apiTestGitUrl };
  }
  const parsed = new URL(config.apiTestGitUrl);
  const redacted = `${parsed.protocol}//x-access-token:***@${parsed.host}${parsed.pathname}`;
  parsed.username = "x-access-token";
  parsed.password = config.apiTestGitToken;
  return { url: parsed.toString(), redacted };
}

export interface DiscoveredSuite {
  path: string;
  name: string;
  key: string;
}

/** testcases 下的一级目录就是一个套件；子目录交给 pytest 递归收集，不再单独成套件。 */
export async function discoverSuites(root: string, found: DiscoveredSuite[]): Promise<void> {
  const base = join(root, "testcases");
  const entries = await readdir(base, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "__pycache__" || entry.name.startsWith(".")) continue;
    if (!(await containsTests(join(base, entry.name)))) continue;
    const path = `testcases/${entry.name}`;
    found.push({ path, name: entry.name, key: suiteKey(path) });
  }
}

/** 整个目录树里只要有一个 test_*.py 就算有测试。 */
async function containsTests(directory: string): Promise<boolean> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && /^test_.*\.py$/.test(entry.name))) return true;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "__pycache__" || entry.name.startsWith(".")) continue;
    if (await containsTests(join(directory, entry.name))) return true;
  }
  return false;
}

/**
 * 静态扫描用例清单。扫描失败不阻断同步：返回 null，本轮只更新套件、不动已有用例。
 * 这里不能复用 `run`，因为 python 需要 PYTHONPATH 才能 import 镜像里的 harness。
 */
function scanCases(config: WorkerConfig, root: string): Promise<CollectedCase[] | null> {
  return new Promise((resolve) => {
    const child = spawn(config.apiTestPython, ["-m", "harness.collect_cases", "."], {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME ?? "/home/node",
        LANG: "C.UTF-8",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONPATH: `${config.apiTestHarnessRoot}:${root}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let overflow = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (overflow) return;
      stdout += chunk.toString("utf8");
      if (stdout.length > CASE_OUTPUT_LIMIT) {
        overflow = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.resume();

    const timer = setTimeout(() => child.kill("SIGKILL"), CASE_SCAN_TIMEOUT_MS);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (overflow || code !== 0) {
        resolve(null);
        return;
      }
      const cases: CollectedCase[] = [];
      for (const line of stdout.split("\n")) {
        if (line.trim() === "") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line) as unknown;
        } catch {
          resolve(null);
          return;
        }
        if (!isCollectedCase(parsed)) continue;
        cases.push(parsed);
      }
      resolve(cases);
    });
  });
}

function isCollectedCase(value: unknown): value is CollectedCase {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["file_path"] === "string" &&
    typeof record["node_id"] === "string" &&
    typeof record["name"] === "string" &&
    (record["kind"] === "file" || record["kind"] === "case") &&
    typeof record["ordinal"] === "number"
  );
}

/** 用例的 node_id 以测试集目录开头；嵌套目录取最长匹配，避免误挂到外层套件。 */
export function suiteForNode<T extends { path: string }>(
  nodeId: string,
  suites: readonly T[],
): T | null {
  let matched: T | null = null;
  for (const suite of suites) {
    if (nodeId !== suite.path && !nodeId.startsWith(`${suite.path}/`)) continue;
    if (matched === null || suite.path.length > matched.path.length) matched = suite;
  }
  return matched;
}

/** key 只用于内部引用和排序，重复风险交给路径唯一索引，加摘要后缀避免跨路径撞车。 */
export function suiteKey(path: string): string {
  const slug = path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const digest = createHash("sha1").update(path).digest("hex").slice(0, 6);
  return slug === "" ? `suite-${digest}` : `${slug}-${digest}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function tail(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= MESSAGE_LIMIT ? trimmed : trimmed.slice(-MESSAGE_LIMIT);
}

export async function processApiTestSync(
  job: ApiTestSyncJob,
  dependencies: { database: Database; config: WorkerConfig },
): Promise<void> {
  const { database, config } = dependencies;
  const repository = new ApiTestRepository();
  const sync = await repository.findSync(database, job.syncId);
  if (sync === null) return;
  if (!(await repository.markSyncRunning(database, job.syncId))) return;

  // 只改 queued/running 的记录：重投或并发补偿时不会把已完成的同步改回失败。
  const fail = async (message: string): Promise<void> => {
    await repository.expireSync(database, job.syncId, tail(message));
  };

  try {
    await syncRepositoryToHead(job, { database, config, repository, fail });
  } catch (error) {
    // 未预期的异常也要落成 failed，否则记录会一直停在 running 挡住后续同步。
    await fail(`同步中断: ${(error as Error).message}`);
    throw error;
  }
}

async function syncRepositoryToHead(
  job: ApiTestSyncJob,
  context: {
    database: Database;
    config: WorkerConfig;
    repository: ApiTestRepository;
    fail: (message: string) => Promise<void>;
  },
): Promise<void> {
  const { database, config, repository, fail } = context;
  const repo = config.apiTestRoot;
  try {
    await mkdir(repo, { recursive: true });
  } catch (error) {
    await fail(`无法创建工作目录: ${(error as Error).message}`);
    return;
  }

  const remote = remoteUrl(config);
  const git = async (...args: string[]): Promise<CommandResult> =>
    run("git", args, { cwd: repo });

  // 首次同步初始化工作区，之后只改 remote，避免 token 留在 .git/config 里。
  const isRepo = (await git("rev-parse", "--git-dir")).code === 0;
  if (!isRepo) {
    const init = await git("init", "-q");
    if (init.code !== 0) {
      await fail(`git init 失败: ${tail(init.stderr)}`);
      return;
    }
  }
  const setRemote = await git("remote", "set-url", "origin", remote.url).then((result) =>
    result.code === 0 ? result : git("remote", "add", "origin", remote.url),
  );
  if (setRemote.code !== 0) {
    await fail(`配置远端失败: ${tail(setRemote.stderr)}`);
    return;
  }

  const before = await git("rev-parse", "HEAD");
  const previousSha = before.code === 0 ? before.stdout.trim() : null;

  const fetch = await git("fetch", "--prune", "--depth", "1", "origin", config.apiTestGitBranch);
  // 取到之后立刻把带 token 的 remote 换回无凭据地址，别让它留在 .git/config 里。
  if (remote.redacted !== config.apiTestGitUrl) {
    await git("remote", "set-url", "origin", config.apiTestGitUrl);
  }
  if (fetch.code !== 0) {
    await fail(`拉取 ${remote.redacted} 失败: ${tail(fetch.stderr)}`);
    return;
  }

  const reset = await git("reset", "--hard", "FETCH_HEAD");
  if (reset.code !== 0) {
    await fail(`切换工作副本失败: ${tail(reset.stderr)}`);
    return;
  }
  await git("clean", "-fd", "-e", "__pycache__");

  const head = await git("rev-parse", "HEAD");
  if (head.code !== 0) {
    await fail(`读取 commit 失败: ${tail(head.stderr)}`);
    return;
  }
  const commit = head.stdout.trim();

  const changed = await git("show", "--name-only", "--pretty=format:", "HEAD");
  const changedFiles = changed.stdout.split("\n").filter((line) => line.trim() !== "").length;

  // 套件按目录发现；仓库里消失的目录停用，历史执行记录保留。
  const found: DiscoveredSuite[] = [];
  try {
    await discoverSuites(repo, found);
  } catch (error) {
    await fail(`扫描 testcases 失败: ${(error as Error).message}`);
    return;
  }
  if (found.length === 0) {
    await fail("仓库里没有找到任何 testcases 目录，确认分支和仓库地址是否正确。");
    return;
  }
  let suitesAdded = 0;
  for (const suite of found) {
    const inserted = await repository.upsertDiscoveredSuite(database, {
      id: newId(),
      key: suite.key,
      name: suite.name,
      path: suite.path,
      commit,
    });
    if (inserted) suitesAdded += 1;
  }
  const suitesRemoved = await repository.disableSuitesMissing(
    database,
    commit,
    found.map((suite) => suite.path),
  );

  // 用例编目是附加信息：扫描失败只影响选择器，不影响套件同步和已有执行。
  let casesAdded = 0;
  let casesRemoved = 0;
  const collected = await scanCases(config, repo);
  if (collected !== null) {
    const suites = await repository.listSuites(database);
    const rows = [];
    for (const item of collected) {
      const suite = suiteForNode(item.node_id, suites);
      if (suite === null) continue;
      rows.push({
        id: newId(),
        suiteId: suite.id,
        nodeId: item.node_id,
        filePath: item.file_path,
        name: item.name,
        kind: item.kind,
        ordinal: item.ordinal,
        commit,
      });
    }
    casesAdded = await repository.upsertCases(database, rows);
    // 只有完整扫描成功才停用旧用例，避免一次临时失败把整个选择器清空。
    casesRemoved = await repository.disableCasesMissing(database, commit);
  }

  let requirementsChanged = false;
  try {
    const requirements = await readFile(join(repo, "requirements.txt"), "utf8");
    const pinned =
      config.apiTestRequirementsSha ??
      (await readFile(join(config.apiTestHarnessRoot, "upstream-requirements.sha"), "utf8")).trim();
    requirementsChanged = sha256(requirements) !== pinned;
  } catch {
    // 没有 requirements.txt 说明这个仓库不需要额外依赖，不算问题。
  }

  await repository.finishSync(database, job.syncId, {
    status: "succeeded",
    commitSha: commit,
    previousSha,
    changedFiles,
    suitesAdded,
    suitesRemoved,
    casesAdded,
    casesRemoved,
    requirementsChanged,
    message: requirementsChanged
      ? "上游依赖有变化，需要重新构建 worker 镜像后再执行用例。"
      : null,
  });
}
