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

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
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

  const fail = async (message: string): Promise<void> => {
    await repository.finishSync(database, job.syncId, {
      status: "failed",
      commitSha: null,
      previousSha: null,
      changedFiles: 0,
      suitesAdded: 0,
      suitesRemoved: 0,
      requirementsChanged: false,
      message: tail(message),
    });
  };

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
    requirementsChanged,
    message: requirementsChanged
      ? "上游依赖有变化，需要重新构建 worker 镜像后再执行用例。"
      : null,
  });
}
