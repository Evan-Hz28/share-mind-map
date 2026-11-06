import {
  ApiTestRepository,
  groupCollectionTargets,
  newId,
  type ApiTestRunTarget,
  type ApiTestScheduleRecord,
  type Database,
} from "@share-mind-map/database";
import type { Queue } from "bullmq";
import { CronExpressionParser } from "cron-parser";

import type { WorkerConfig } from "../config.js";
import { processApiTestSync } from "./sync.js";

export interface ApiTestScheduleJob {
  scheduleId: string;
}

interface ScheduleDependencies {
  database: Database;
  config: WorkerConfig;
  runQueue: Queue<{ runId: string }>;
}


const SYNC_WAIT_LIMIT_MS = 10 * 60 * 1000;
const SYNC_WAIT_INTERVAL_MS = 5_000;

function nextRunAt(schedule: ApiTestScheduleRecord): Date | null {
  try {
    const iterator = CronExpressionParser.parse(schedule.cron, {
      tz: schedule.timezone,
      currentDate: new Date(),
    });
    return iterator.next().toDate();
  } catch {
    return null;
  }
}

/** 目标套件可能被同步任务停用或删除，解析不到就当作无效目标处理。 */
async function resolveTargets(
  repository: ApiTestRepository,
  database: Database,
  schedule: ApiTestScheduleRecord,
): Promise<ApiTestRunTarget[] | null> {
  if (schedule.targetType === "suite") {
    const suite = await repository.findSuite(database, schedule.targetId);
    return suite === null ? null : [{ suiteId: suite.id, path: suite.path, nodeIds: [] }];
  }
  if ((await repository.findCollection(database, schedule.targetId)) === null) return null;
  const items = await repository.listCollectionItems(database, schedule.targetId);
  return groupCollectionTargets(items);
}

/** 同步任务只允许一个并发，队列里已有就直接排队等它，不要并行 reset 工作区。 */
async function waitForActiveSync(
  repository: ApiTestRepository,
  database: Database,
): Promise<boolean> {
  const deadline = Date.now() + SYNC_WAIT_LIMIT_MS;
  while (Date.now() < deadline) {
    if ((await repository.findActiveSync(database)) === null) return true;
    await new Promise((resolve) => setTimeout(resolve, SYNC_WAIT_INTERVAL_MS));
  }
  return false;
}

/** 返回 null 表示同步成功；否则是写进 last_error 的原因。 */
async function syncBeforeRun(
  repository: ApiTestRepository,
  dependencies: ScheduleDependencies,
  requestedBy: string,
): Promise<string | null> {
  const { database, config } = dependencies;
  if (!(await waitForActiveSync(repository, database))) {
    return "等待进行中的用例同步超时，本次执行已跳过。";
  }
  const sync = await repository.createSync(database, {
    id: newId(),
    branch: config.apiTestGitBranch,
    trigger: "schedule",
    requestedBy,
  });
  await processApiTestSync({ syncId: sync.id }, { database, config });
  const finished = await repository.findSync(database, sync.id);
  if (finished === null || finished.status !== "succeeded") {
    // 拿旧代码出的报告没有意义，宁可跳过这一轮。
    return `执行前同步失败：${finished?.message ?? "未知原因"}`;
  }
  return null;
}

/**
 * 启动时按库里的表重建 Redis 调度：容器重建、换 Redis 之后都能自愈。
 * 表里没有的调度（比如删除时没清干净）一并摘掉。
 */
export async function restoreApiTestSchedulers(
  queue: Queue<ApiTestScheduleJob>,
  database: Database,
): Promise<void> {
  const repository = new ApiTestRepository();
  const schedules = (await repository.listSchedules(database)).filter(
    (schedule) => schedule.enabled,
  );
  const keep = new Set(schedules.map((schedule) => schedule.id));
  for (const schedule of schedules) {
    await queue.upsertJobScheduler(
      schedule.id,
      { pattern: schedule.cron, tz: schedule.timezone },
      {
        name: "scheduled-run",
        data: { scheduleId: schedule.id },
        opts: { removeOnComplete: true, removeOnFail: 50 },
      },
    );
  }
  const existing = await queue.getJobSchedulers(0, 1000, true);
  for (const job of existing) {
    const id = job.id;
    if (typeof id !== "string" || keep.has(id)) continue;
    await queue.removeJobScheduler(id);
  }
}

/**
 * 定时触发一次：建批次、逐个 run 入队，然后回写批次和下次执行时间。
 * 目标消失或环境失效这类永久错误会顺手停用任务，避免每轮都失败。
 */
export async function processApiTestSchedule(
  job: ApiTestScheduleJob,
  dependencies: ScheduleDependencies,
): Promise<void> {
  const { database, runQueue } = dependencies;
  const repository = new ApiTestRepository();
  const schedule = await repository.findSchedule(database, job.scheduleId);
  if (schedule === null || !schedule.enabled) return;

  const fail = (message: string, disable: boolean): Promise<void> =>
    repository.setScheduleFailure(database, schedule.id, { message, disable });

  // 下面的 await 会打断收窄，先取出非空创建者再用。
  const createdBy = schedule.createdBy;
  if (createdBy === null) {
    await fail("创建者已失效，请重新创建定时任务。", true);
    return;
  }
  if ((await repository.findEnvironment(database, schedule.environmentId)) === null) {
    await fail("绑定的测试环境已失效，请重新选择环境。", true);
    return;
  }

  if (schedule.syncBeforeRun) {
    const syncError = await syncBeforeRun(repository, dependencies, createdBy);
    if (syncError !== null) {
      await fail(syncError, false);
      return;
    }
  }

  const targets = await resolveTargets(repository, database, schedule);
  if (targets === null) {
    await fail("目标测试集或测试集合已不存在。", true);
    return;
  }
  if (targets.length === 0) {
    await fail("目标里没有可执行的测试集。", true);
    return;
  }

  const batchId = newId();
  const collectionId = schedule.targetType === "collection" ? schedule.targetId : null;
  for (const target of targets) {
    const selection =
      target.nodeIds.length > 0 ? { path: target.path, nodeIds: target.nodeIds } : { path: target.path };
    const run = await repository.createRun(database, {
      id: newId(),
      suiteId: target.suiteId,
      environmentId: schedule.environmentId,
      requestedBy: createdBy,
      mode: target.nodeIds.length > 0 ? "selected" : "suite",
      selection,
      batchId,
      collectionId,
    });
    await runQueue.add("run", { runId: run.id }, { jobId: run.id });
  }

  await repository.recordScheduleRun(database, schedule.id, {
    batchId,
    runAt: new Date(),
    nextRunAt: nextRunAt(schedule),
  });
}
