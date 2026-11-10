import {
  API_TEST_SYNC_STALE_SECONDS,
  ApiTestRepository,
  groupCollectionTargets,
  newId,
  type ApiTestCaseRecord,
  type ApiTestCollectionExecutionRecord,
  type ApiTestCollectionItemRecord,
  type ApiTestCollectionRecord,
  type ApiTestRunItemRecord,
  type ApiTestRunRecord,
  type ApiTestRunTarget,
  type ApiTestScheduleRecord,
  type ApiTestScheduleTargetType,
  type ApiTestSyncRecord,
  type Database,
} from "@share-mind-map/database";
import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { CronExpressionParser } from "cron-parser";
import Redis from "ioredis";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import type { AppConfig } from "../platform/config/app-config.js";
import { APP_CONFIG } from "../platform/config/config.module.js";
import { ApiError } from "../platform/errors/api-error.js";
import type {
  ApiTestBatchResponseDto,
  ApiTestCaseResponseDto,
  ApiTestCollectionDetailResponseDto,
  ApiTestCollectionExecutionResponseDto,
  ApiTestCollectionItemResponseDto,
  ApiTestCollectionResponseDto,
  ApiTestEnvironmentResponseDto,
  ApiTestRunDetailResponseDto,
  ApiTestRunItemResponseDto,
  ApiTestRunResponseDto,
  ApiTestScheduleResponseDto,
  ApiTestSuiteResponseDto,
  ApiTestSyncResponseDto,
} from "./dto/api-test.dto.js";

/** 集合成员输入：type=suite 表示整个测试集，type=case 表示一个文件或函数。 */
export interface ApiTestCollectionItemInput {
  type: "suite" | "case";
  id: string;
}

export const API_TEST_QUEUE = "api-test-run";
export const API_TEST_SYNC_QUEUE = "api-test-sync";
export const API_TEST_SCHEDULE_QUEUE = "api-test-schedule";

/** 只接受五段 cron：六段能写秒级，worker 单并发扛不住。 */
const FIVE_FIELD_CRON = /^\S+(?:\s+\S+){4}$/;
const DEFAULT_SCHEDULE_TIMEZONE = "Asia/Shanghai";

interface ApiTestRunJob {
  runId: string;
}

interface ApiTestSyncJob {
  syncId: string;
}

interface ApiTestScheduleJob {
  scheduleId: string;
}

function mapRun(run: ApiTestRunRecord): ApiTestRunResponseDto {
  return {
    id: run.id,
    suiteId: run.suiteId,
    suiteKey: run.suiteKey,
    suiteName: run.suiteName,
    environmentId: run.environmentId,
    environmentKey: run.environmentKey,
    environmentName: run.environmentName,
    batchId: run.batchId,
    collectionId: run.collectionId,
    selection: run.selection,
    repoCommit: run.repoCommit,
    status: run.status,
    cancelRequested: run.cancelRequested,
    totalCount: run.totalCount,
    passedCount: run.passedCount,
    failedCount: run.failedCount,
    skippedCount: run.skippedCount,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

function mapItem(item: ApiTestRunItemRecord): ApiTestRunItemResponseDto {
  return {
    id: item.id,
    nodeId: item.nodeId,
    caseName: item.caseName,
    ordinal: item.ordinal,
    status: item.status,
    durationMs: item.durationMs,
    failure: item.failure,
    request: item.request,
    response: item.response,
  };
}

function mapSync(sync: ApiTestSyncRecord): ApiTestSyncResponseDto {
  return {
    id: sync.id,
    branch: sync.branch,
    status: sync.status,
    trigger: sync.trigger,
    requestedBy: sync.requestedBy,
    commitSha: sync.commitSha,
    previousSha: sync.previousSha,
    changedFiles: sync.changedFiles,
    suitesAdded: sync.suitesAdded,
    suitesRemoved: sync.suitesRemoved,
    casesAdded: sync.casesAdded,
    casesRemoved: sync.casesRemoved,
    requirementsChanged: sync.requirementsChanged,
    message: sync.message,
    startedAt: sync.startedAt?.toISOString() ?? null,
    finishedAt: sync.finishedAt?.toISOString() ?? null,
    createdAt: sync.createdAt.toISOString(),
  };
}

function mapCollection(collection: ApiTestCollectionRecord): ApiTestCollectionResponseDto {
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    suiteCount: collection.suiteCount,
    caseCount: collection.caseCount,
    lastRunStatus: collection.lastRunStatus,
    lastRunAt: collection.lastRunAt?.toISOString() ?? null,
    createdAt: collection.createdAt.toISOString(),
    updatedAt: collection.updatedAt.toISOString(),
  };
}

function mapCollectionItem(
  item: ApiTestCollectionItemRecord,
): ApiTestCollectionItemResponseDto {
  return {
    id: item.id,
    position: item.position,
    type: item.caseId === null ? "suite" : "case",
    suiteId: item.suiteId,
    suiteKey: item.suiteKey,
    suiteName: item.suiteName,
    suitePath: item.suitePath,
    suiteEnabled: item.suiteEnabled,
    caseId: item.caseId,
    caseNodeId: item.caseNodeId,
    caseName: item.caseName,
    caseKind: item.caseKind,
    caseEnabled: item.caseEnabled,
    lastRunId: item.lastRunId,
    lastRunStatus: item.lastRunStatus,
    totalCount: item.totalCount,
    passedCount: item.passedCount,
    failedCount: item.failedCount,
    skippedCount: item.skippedCount,
    lastRunAt: item.lastRunAt?.toISOString() ?? null,
  };
}

function mapCase(item: {
  id: string;
  suiteId: string;
  nodeId: string;
  filePath: string;
  name: string;
  kind: "file" | "case";
  ordinal: number;
}): ApiTestCaseResponseDto {
  return {
    id: item.id,
    suiteId: item.suiteId,
    nodeId: item.nodeId,
    filePath: item.filePath,
    name: item.name,
    kind: item.kind,
    ordinal: item.ordinal,
  };
}

function mapCollectionExecution(
  execution: ApiTestCollectionExecutionRecord,
): ApiTestCollectionExecutionResponseDto {
  return {
    batchId: execution.batchId,
    status: execution.status,
    suiteCount: execution.suiteCount,
    totalCount: execution.totalCount,
    passedCount: execution.passedCount,
    failedCount: execution.failedCount,
    skippedCount: execution.skippedCount,
    startedAt: execution.startedAt?.toISOString() ?? null,
    finishedAt: execution.finishedAt?.toISOString() ?? null,
    createdAt: execution.createdAt.toISOString(),
  };
}

function mapSchedule(schedule: ApiTestScheduleRecord): ApiTestScheduleResponseDto {
  return {
    id: schedule.id,
    name: schedule.name,
    targetType: schedule.targetType,
    targetId: schedule.targetId,
    targetName: schedule.targetName,
    targetPath: schedule.targetPath,
    environmentId: schedule.environmentId,
    environmentName: schedule.environmentName,
    environmentKey: schedule.environmentKey,
    cron: schedule.cron,
    timezone: schedule.timezone,
    syncBeforeRun: schedule.syncBeforeRun,
    enabled: schedule.enabled,
    nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
    lastBatchId: schedule.lastBatchId,
    lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
    lastRunStatus: schedule.lastRunStatus,
    lastTotalCount: schedule.lastTotalCount,
    lastPassedCount: schedule.lastPassedCount,
    lastFailedCount: schedule.lastFailedCount,
    lastSkippedCount: schedule.lastSkippedCount,
    lastError: schedule.lastError,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

/** 先按 cron 算出接下来的触发时间，无效表达式和无效时区统一翻成业务错误码。 */
function nextCronRuns(cron: string, timezone: string, count: number): Date[] {
  const expression = cron.trim();
  if (!FIVE_FIELD_CRON.test(expression)) throw new ApiError("API_TEST_SCHEDULE_CRON_INVALID");
  try {
    const iterator = CronExpressionParser.parse(expression, {
      tz: timezone,
      currentDate: new Date(),
    });
    const runs: Date[] = [];
    for (let index = 0; index < count; index += 1) runs.push(iterator.next().toDate());
    return runs;
  } catch {
    throw new ApiError("API_TEST_SCHEDULE_CRON_INVALID");
  }
}

/** 集合名有唯一索引，撞名时把 pg 的 23505 翻译成业务错误码。 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

@Injectable()
export class ApiTestsService implements OnApplicationShutdown {
  private readonly repository = new ApiTestRepository();
  private readonly queue: Queue<ApiTestRunJob>;
  private readonly syncQueue: Queue<ApiTestSyncJob>;
  private readonly scheduleQueue: Queue<ApiTestScheduleJob>;
  private readonly redis: Redis;

  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<ApiTestRunJob>(API_TEST_QUEUE, {
      connection: this.redis,
      prefix: config.queuePrefix,
    });
    this.syncQueue = new Queue<ApiTestSyncJob>(API_TEST_SYNC_QUEUE, {
      connection: this.redis,
      prefix: config.queuePrefix,
    });
    this.scheduleQueue = new Queue<ApiTestScheduleJob>(API_TEST_SCHEDULE_QUEUE, {
      connection: this.redis,
      prefix: config.queuePrefix,
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.syncQueue.close();
    await this.scheduleQueue.close();
    await this.redis.quit();
  }

  public async listSuites(): Promise<ApiTestSuiteResponseDto[]> {
    const suites = await this.repository.listSuites(this.database);
    return suites.map((suite) => ({
      id: suite.id,
      key: suite.key,
      name: suite.name,
      path: suite.path,
      caseCount: suite.caseCount,
      fileCount: suite.fileCount,
    }));
  }

  /** 测试集下的用例编目；前端按需懒加载，不随套件列表一起下发。 */
  public async listCases(suiteId: string): Promise<ApiTestCaseResponseDto[]> {
    if ((await this.repository.findSuite(this.database, suiteId)) === null) {
      throw new ApiError("API_TEST_SUITE_NOT_FOUND");
    }
    const cases = await this.repository.listCases(this.database, suiteId);
    return cases.map(mapCase);
  }

  public async listEnvironments(): Promise<ApiTestEnvironmentResponseDto[]> {
    const environments = await this.repository.listEnvironments(this.database);
    return environments.map((environment) => ({
      id: environment.id,
      key: environment.key,
      name: environment.name,
      baseUrl: environment.baseUrl,
    }));
  }

  /**
   * 可以选整个测试集，也可以选具体文件/函数；按选择顺序入队，worker 单并发。
   * 同一测试集既选整体又选用例时整体优先，避免同一批里重复跑一遍。
   * 这批 run 共享一个 batchId，报告页据此聚合成一个任务。
   */
  public async createRuns(
    auth: AuthContext,
    input: { suiteIds?: string[]; caseIds?: string[]; environmentId: string },
  ): Promise<{ batchId: string; runs: ApiTestRunResponseDto[] }> {
    const suiteIds = [...new Set(input.suiteIds ?? [])];
    const caseIds = [...new Set(input.caseIds ?? [])];
    if (suiteIds.length === 0 && caseIds.length === 0) {
      throw new ApiError("API_TEST_RUN_TARGET_REQUIRED");
    }

    const targets: ApiTestRunTarget[] = [];
    const wholeSuites = new Set<string>();
    for (const suiteId of suiteIds) {
      const suite = await this.repository.findSuite(this.database, suiteId);
      if (suite === null) throw new ApiError("API_TEST_SUITE_NOT_FOUND");
      wholeSuites.add(suite.id);
      targets.push({ suiteId: suite.id, path: suite.path, nodeIds: [] });
    }

    // 用例按测试集分组；整体已选中的测试集跳过，保持「整体优先」。
    const selectedCases: ApiTestCaseRecord[] = [];
    for (const caseId of caseIds) {
      const testCase = await this.repository.findCase(this.database, caseId);
      if (testCase === null) throw new ApiError("API_TEST_CASE_NOT_FOUND");
      if (wholeSuites.has(testCase.suiteId)) continue;
      selectedCases.push(testCase);
    }
    // 文件行优先于它下面的函数行，避免同一个用例重复执行。
    const fileNodes = new Map<string, Set<string>>();
    for (const testCase of selectedCases) {
      if (testCase.kind !== "file") continue;
      const files = fileNodes.get(testCase.suiteId) ?? new Set<string>();
      files.add(testCase.nodeId);
      fileNodes.set(testCase.suiteId, files);
    }
    const caseGroups = new Map<string, ApiTestRunTarget>();
    for (const testCase of selectedCases) {
      if (testCase.kind === "case") {
        const separator = testCase.nodeId.indexOf("::");
        if (
          separator !== -1 &&
          fileNodes.get(testCase.suiteId)?.has(testCase.nodeId.slice(0, separator)) === true
        ) {
          continue;
        }
      }
      const suite = await this.repository.findSuite(this.database, testCase.suiteId);
      if (suite === null) throw new ApiError("API_TEST_SUITE_NOT_FOUND");
      const existing = caseGroups.get(suite.id);
      if (existing === undefined) {
        const target = { suiteId: suite.id, path: suite.path, nodeIds: [testCase.nodeId] };
        caseGroups.set(suite.id, target);
        targets.push(target);
      } else if (!existing.nodeIds.includes(testCase.nodeId)) {
        existing.nodeIds.push(testCase.nodeId);
      }
    }

    return this.enqueueRuns(auth, targets, input.environmentId, null);
  }

  /**
   * 失败重跑：沿用原 run 的测试集、环境和精确 node id。
   * node id 自带参数化后缀，所以 `[body2-400-1001]` 这类失败只重跑对应参数组合。
   */
  public async rerunRunItem(
    auth: AuthContext,
    itemId: string,
  ): Promise<{ batchId: string; runs: ApiTestRunResponseDto[] }> {
    const item = await this.repository.findRunItem(this.database, itemId);
    if (item === null) throw new ApiError("API_TEST_RUN_ITEM_NOT_FOUND");
    const run = await this.repository.findRun(this.database, item.runId);
    if (run === null) throw new ApiError("API_TEST_RUN_NOT_FOUND");
    return this.enqueueRuns(
      auth,
      [{ suiteId: run.suiteId, path: run.suitePath, nodeIds: [item.nodeId] }],
      run.environmentId,
      null,
    );
  }

  /** 集合和散跑共用：入队顺序就是执行顺序，worker 单并发，一批共享 batchId。 */
  private async enqueueRuns(
    auth: AuthContext,
    targets: ApiTestRunTarget[],
    environmentId: string,
    collectionId: string | null,
  ): Promise<{ batchId: string; runs: ApiTestRunResponseDto[] }> {
    const environment = await this.repository.findEnvironment(this.database, environmentId);
    if (environment === null) throw new ApiError("API_TEST_ENVIRONMENT_NOT_FOUND");

    const batchId = newId();
    const runs = [];
    for (const target of targets) {
      const selected = target.nodeIds.length > 0;
      const run = await this.repository.createRun(this.database, {
        id: newId(),
        suiteId: target.suiteId,
        environmentId: environment.id,
        requestedBy: auth.session.userId,
        mode: selected ? "selected" : "suite",
        selection: selected
          ? { path: target.path, nodeIds: target.nodeIds }
          : { path: target.path },
        batchId,
        collectionId,
      });
      await this.queue.add("run", { runId: run.id }, { jobId: run.id });
      runs.push(mapRun(run));
    }
    return { batchId, runs };
  }

  public async listCollections(): Promise<ApiTestCollectionResponseDto[]> {
    const collections = await this.repository.listCollections(this.database);
    return collections.map(mapCollection);
  }

  public async getCollection(collectionId: string): Promise<ApiTestCollectionDetailResponseDto> {
    const collection = await this.repository.findCollection(this.database, collectionId);
    if (collection === null) throw new ApiError("API_TEST_COLLECTION_NOT_FOUND");
    const items = await this.repository.listCollectionItems(this.database, collectionId);
    return Object.assign(mapCollection(collection), { items: items.map(mapCollectionItem) });
  }

  public async createCollection(
    auth: AuthContext,
    input: { name: string; description: string; items: ApiTestCollectionItemInput[] },
  ): Promise<ApiTestCollectionDetailResponseDto> {
    const name = input.name.trim();
    if (name === "") throw new ApiError("API_TEST_COLLECTION_NAME_INVALID");
    const items = await this.resolveCollectionItems(input.items);
    const created = await this.repository
      .createCollection(this.database, {
        id: newId(),
        name,
        description: input.description.trim(),
        createdBy: auth.session.userId,
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new ApiError("API_TEST_COLLECTION_NAME_CONFLICT");
        throw error;
      });
    await this.repository.replaceCollectionItems(this.database, created.id, items);
    return this.getCollection(created.id);
  }

  public async updateCollection(
    collectionId: string,
    input: { name: string; description: string },
  ): Promise<ApiTestCollectionDetailResponseDto> {
    const name = input.name.trim();
    if (name === "") throw new ApiError("API_TEST_COLLECTION_NAME_INVALID");
    const updated = await this.repository
      .updateCollection(this.database, collectionId, {
        name,
        description: input.description.trim(),
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new ApiError("API_TEST_COLLECTION_NAME_CONFLICT");
        throw error;
      });
    if (updated === null) throw new ApiError("API_TEST_COLLECTION_NOT_FOUND");
    return this.getCollection(collectionId);
  }

  public async deleteCollection(collectionId: string): Promise<void> {
    const deleted = await this.repository.deleteCollection(this.database, collectionId);
    if (!deleted) throw new ApiError("API_TEST_COLLECTION_NOT_FOUND");
    // 目标没了，指向这个集合的定时任务留着只会每轮失败，连带删除。
    // 先删表再摘调度：万一摘调度失败，worker 查不到 scheduleId 会直接跳过，不会误跑。
    const removed = await this.repository.deleteSchedulesByTarget(
      this.database,
      "collection",
      collectionId,
    );
    await Promise.all(
      removed.map((id) => this.scheduleQueue.removeJobScheduler(id).catch(() => undefined)),
    );
  }

  public async setCollectionItems(
    collectionId: string,
    input: ApiTestCollectionItemInput[],
  ): Promise<ApiTestCollectionDetailResponseDto> {
    const collection = await this.repository.findCollection(this.database, collectionId);
    if (collection === null) throw new ApiError("API_TEST_COLLECTION_NOT_FOUND");
    const items = await this.resolveCollectionItems(input);
    await this.repository.replaceCollectionItems(this.database, collectionId, items);
    return this.getCollection(collectionId);
  }

  public async runCollection(
    auth: AuthContext,
    collectionId: string,
    environmentId: string,
  ): Promise<{ batchId: string; runs: ApiTestRunResponseDto[] }> {
    const collection = await this.repository.findCollection(this.database, collectionId);
    if (collection === null) throw new ApiError("API_TEST_COLLECTION_NOT_FOUND");
    const items = await this.repository.listCollectionItems(this.database, collectionId);
    const targets = groupCollectionTargets(items);
    if (targets.length === 0) throw new ApiError("API_TEST_COLLECTION_EMPTY");
    return this.enqueueRuns(auth, targets, environmentId, collectionId);
  }

  public async listCollectionExecutions(
    collectionId: string,
    limit: number,
  ): Promise<ApiTestCollectionExecutionResponseDto[]> {
    const collection = await this.repository.findCollection(this.database, collectionId);
    if (collection === null) throw new ApiError("API_TEST_COLLECTION_NOT_FOUND");
    const executions = await this.repository.listCollectionExecutions(
      this.database,
      collectionId,
      limit,
    );
    return executions.map(mapCollectionExecution);
  }

  /**
   * 校验集合成员并转成库里的 `{suiteId, caseId}`。
   * 重复成员按第一次出现保留；用例必须仍在编目里且属于其测试集，否则拒绝保存。
   */
  private async resolveCollectionItems(
    items: ApiTestCollectionItemInput[],
  ): Promise<{ suiteId: string; caseId: string | null }[]> {
    const resolved: { suiteId: string; caseId: string | null }[] = [];
    const seenSuites = new Set<string>();
    const seenCases = new Set<string>();
    for (const item of items) {
      if (item.type === "suite") {
        if (seenSuites.has(item.id)) continue;
        const suite = await this.repository.findSuite(this.database, item.id);
        if (suite === null) throw new ApiError("API_TEST_SUITE_NOT_FOUND");
        seenSuites.add(suite.id);
        resolved.push({ suiteId: suite.id, caseId: null });
        continue;
      }
      if (seenCases.has(item.id)) continue;
      const testCase = await this.repository.findCase(this.database, item.id);
      if (testCase === null) throw new ApiError("API_TEST_CASE_NOT_FOUND");
      if ((await this.repository.findSuite(this.database, testCase.suiteId)) === null) {
        throw new ApiError("API_TEST_SUITE_NOT_FOUND");
      }
      seenCases.add(testCase.id);
      resolved.push({ suiteId: testCase.suiteId, caseId: testCase.id });
    }
    return resolved;
  }

  public async listRuns(
    limit: number,
    filter: { suiteId?: string; batchId?: string },
  ): Promise<ApiTestRunResponseDto[]> {
    const runs = await this.repository.listRuns(this.database, limit, filter);
    return runs.map(mapRun);
  }

  public async getBatch(batchId: string): Promise<ApiTestBatchResponseDto> {
    const runs = await this.repository.listRunsByBatch(this.database, batchId);
    if (runs.length === 0) throw new ApiError("API_TEST_BATCH_NOT_FOUND");
    const first = runs[0] as ApiTestRunRecord;
    const totals = { suiteCount: runs.length, totalCount: 0, passedCount: 0, failedCount: 0, skippedCount: 0 };
    for (const run of runs) {
      totals.totalCount += run.totalCount;
      totals.passedCount += run.passedCount;
      totals.failedCount += run.failedCount;
      totals.skippedCount += run.skippedCount;
    }
    // 还有没跑完的就算执行中；全部结束后任一套件失败即整批失败。
    const pending = runs.some((run) => run.status === "queued" || run.status === "running");
    const failed = runs.some((run) => run.status === "failed" || run.status === "cancelled");
    return {
      batchId,
      status: pending ? "running" : failed ? "failed" : "succeeded",
      environmentId: first.environmentId,
      environmentName: first.environmentName,
      totals,
      runs: runs.map(mapRun),
    };
  }

  /** 取消整批：worker 单并发，只停当前那一条的话队列里后面的 run 还会接着跑。 */
  public async cancelBatch(batchId: string): Promise<ApiTestBatchResponseDto> {
    const runs = await this.repository.listRunsByBatch(this.database, batchId);
    if (runs.length === 0) throw new ApiError("API_TEST_BATCH_NOT_FOUND");
    for (const run of runs) {
      if (run.status !== "queued" && run.status !== "running") continue;
      await this.repository.requestCancel(this.database, run.id);
      if (run.status === "queued") await this.repository.markCancelled(this.database, run.id);
    }
    return this.getBatch(batchId);
  }

  public async getRun(runId: string): Promise<ApiTestRunDetailResponseDto> {
    const run = await this.repository.findRun(this.database, runId);
    if (run === null) throw new ApiError("API_TEST_RUN_NOT_FOUND");
    const items = await this.repository.listRunItems(this.database, runId);
    return Object.assign(mapRun(run), { items: items.map(mapItem) });
  }

  public async cancelRun(runId: string): Promise<ApiTestRunResponseDto> {
    const run = await this.repository.findRun(this.database, runId);
    if (run === null) throw new ApiError("API_TEST_RUN_NOT_FOUND");
    if (run.status !== "queued" && run.status !== "running") {
      throw new ApiError("API_TEST_RUN_STATE_CONFLICT");
    }
    await this.repository.requestCancel(this.database, runId);
    if (run.status === "queued") {
      await this.repository.markCancelled(this.database, runId);
    }
    const updated = await this.repository.findRun(this.database, runId);
    if (updated === null) throw new ApiError("API_TEST_RUN_NOT_FOUND");
    return mapRun(updated);
  }

  /**
   * 队列里已经没有活 job 的同步记录会永久挡住下一次同步，发现就标记失败。
   * 真正在排队或运行中的任务仍然返回 409。
   */
  private async releaseOrphanSync(active: ApiTestSyncRecord): Promise<boolean> {
    const stale = Date.now() - active.createdAt.getTime() > API_TEST_SYNC_STALE_SECONDS * 1000;
    if (stale) {
      return this.repository.expireSync(
        this.database,
        active.id,
        "同步任务超过 30 分钟没有进展，已自动标记失败。",
      );
    }
    // 定时任务里的同步在 worker 进程内直接执行、不进队列，不能按「队列里没有 job」判定为孤儿。
    if (active.trigger !== "manual") return false;
    const job = await this.syncQueue.getJob(active.id);
    const state = job == null ? null : await job.getState();
    const live =
      state === "active" ||
      state === "delayed" ||
      state === "prioritized" ||
      state === "waiting" ||
      state === "waiting-children";
    if (live) return false;
    return this.repository.expireSync(
      this.database,
      active.id,
      "同步任务已中断（队列中已无对应任务），已自动标记失败。",
    );
  }

  /** 只有手动触发：前端点「同步用例」。 */
  public async syncRepository(requestedBy: string | null): Promise<ApiTestSyncResponseDto> {
    // 先清掉中断留下的孤儿记录，避免一条旧数据让同步永远报「已有任务在执行」。
    for (
      let active = await this.repository.findActiveSync(this.database);
      active !== null;
      active = await this.repository.findActiveSync(this.database)
    ) {
      if (!(await this.releaseOrphanSync(active))) throw new ApiError("API_TEST_SYNC_IN_PROGRESS");
    }
    const sync = await this.repository.createSync(this.database, {
      id: newId(),
      branch: "main",
      trigger: "manual",
      requestedBy,
    });
    try {
      await this.syncQueue.add("sync", { syncId: sync.id }, { jobId: sync.id });
    } catch (error) {
      // 记录已经落库，入队失败必须补偿，否则又留下一条永远 queued 的孤儿。
      await this.repository.expireSync(
        this.database,
        sync.id,
        "同步任务入队失败，已自动标记失败。",
      );
      throw error;
    }
    return mapSync(sync);
  }

  public async listSyncs(limit: number): Promise<ApiTestSyncResponseDto[]> {
    const syncs = await this.repository.listSyncs(this.database, limit);
    return syncs.map(mapSync);
  }

  public async listSchedules(): Promise<ApiTestScheduleResponseDto[]> {
    const schedules = await this.repository.listSchedules(this.database);
    return schedules.map(mapSchedule);
  }

  public async getSchedule(scheduleId: string): Promise<ApiTestScheduleResponseDto> {
    const schedule = await this.repository.findSchedule(this.database, scheduleId);
    if (schedule === null) throw new ApiError("API_TEST_SCHEDULE_NOT_FOUND");
    return mapSchedule(schedule);
  }

  /** 目标、环境和 cron 全部先校验，任何一项不合法都不落库，也不碰 Redis。 */
  public async createSchedule(
    auth: AuthContext,
    input: {
      name: string;
      targetType: ApiTestScheduleTargetType;
      targetId: string;
      environmentId: string;
      cron: string;
      timezone?: string;
      syncBeforeRun?: boolean;
      enabled?: boolean;
    },
  ): Promise<ApiTestScheduleResponseDto> {
    const name = input.name.trim();
    if (name === "") throw new ApiError("API_TEST_SCHEDULE_NAME_INVALID");
    const timezone = input.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
    const enabled = input.enabled ?? true;
    await this.assertScheduleTarget(input.targetType, input.targetId);
    await this.assertEnvironment(input.environmentId);
    const nextRunAt = enabled ? (nextCronRuns(input.cron, timezone, 1)[0] ?? null) : null;
    const created = await this.repository
      .createSchedule(this.database, {
        id: newId(),
        name,
        targetType: input.targetType,
        targetId: input.targetId,
        environmentId: input.environmentId,
        cron: input.cron.trim(),
        timezone,
        syncBeforeRun: input.syncBeforeRun ?? false,
        enabled,
        nextRunAt,
        createdBy: auth.session.userId,
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new ApiError("API_TEST_SCHEDULE_NAME_CONFLICT");
        throw error;
      });
    await this.applyScheduleJob(created);
    return mapSchedule(created);
  }

  public async updateSchedule(
    scheduleId: string,
    input: {
      name: string;
      targetType: ApiTestScheduleTargetType;
      targetId: string;
      environmentId: string;
      cron: string;
      timezone?: string;
      syncBeforeRun?: boolean;
      enabled?: boolean;
    },
  ): Promise<ApiTestScheduleResponseDto> {
    const name = input.name.trim();
    if (name === "") throw new ApiError("API_TEST_SCHEDULE_NAME_INVALID");
    const existing = await this.repository.findSchedule(this.database, scheduleId);
    if (existing === null) throw new ApiError("API_TEST_SCHEDULE_NOT_FOUND");
    const timezone = input.timezone ?? existing.timezone;
    const enabled = input.enabled ?? existing.enabled;
    await this.assertScheduleTarget(input.targetType, input.targetId);
    await this.assertEnvironment(input.environmentId);
    const nextRunAt = enabled ? (nextCronRuns(input.cron, timezone, 1)[0] ?? null) : null;
    const updated = await this.repository
      .updateSchedule(this.database, scheduleId, {
        name,
        targetType: input.targetType,
        targetId: input.targetId,
        environmentId: input.environmentId,
        cron: input.cron.trim(),
        timezone,
        syncBeforeRun: input.syncBeforeRun ?? existing.syncBeforeRun,
        enabled,
        nextRunAt,
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new ApiError("API_TEST_SCHEDULE_NAME_CONFLICT");
        throw error;
      });
    if (updated === null) throw new ApiError("API_TEST_SCHEDULE_NOT_FOUND");
    await this.applyScheduleJob(updated);
    return mapSchedule(updated);
  }

  public async setScheduleEnabled(
    scheduleId: string,
    enabled: boolean,
  ): Promise<ApiTestScheduleResponseDto> {
    const existing = await this.repository.findSchedule(this.database, scheduleId);
    if (existing === null) throw new ApiError("API_TEST_SCHEDULE_NOT_FOUND");
    const nextRunAt = enabled ? (nextCronRuns(existing.cron, existing.timezone, 1)[0] ?? null) : null;
    const updated = await this.repository.setScheduleEnabled(
      this.database,
      scheduleId,
      enabled,
      nextRunAt,
    );
    if (updated === null) throw new ApiError("API_TEST_SCHEDULE_NOT_FOUND");
    await this.applyScheduleJob(updated);
    return mapSchedule(updated);
  }

  public async deleteSchedule(scheduleId: string): Promise<void> {
    const existing = await this.repository.findSchedule(this.database, scheduleId);
    if (existing === null) throw new ApiError("API_TEST_SCHEDULE_NOT_FOUND");
    // 先摘 Redis 里的调度再删表：反过来的话删表成功、摘调度失败会留下孤儿任务。
    await this.scheduleQueue.removeJobScheduler(scheduleId).catch(() => undefined);
    await this.repository.deleteSchedule(this.database, scheduleId);
  }

  /** 手动立即执行一次；不改周期，只记录这次批次。 */
  public async runScheduleNow(
    auth: AuthContext,
    scheduleId: string,
  ): Promise<{ batchId: string; runs: ApiTestRunResponseDto[] }> {
    const schedule = await this.repository.findSchedule(this.database, scheduleId);
    if (schedule === null) throw new ApiError("API_TEST_SCHEDULE_NOT_FOUND");
    const targets = await this.scheduleTargets(schedule.targetType, schedule.targetId);
    const result = await this.enqueueRuns(
      auth,
      targets,
      schedule.environmentId,
      schedule.targetType === "collection" ? schedule.targetId : null,
    );
    await this.repository.recordScheduleRun(this.database, scheduleId, {
      batchId: result.batchId,
      runAt: new Date(),
      nextRunAt: schedule.nextRunAt,
    });
    return result;
  }

  public previewSchedule(cron: string, timezone?: string): { nextRuns: string[] } {
    const zone = timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
    return { nextRuns: nextCronRuns(cron, zone, 3).map((run) => run.toISOString()) };
  }

  /** Redis 里的调度是副本：启用时覆盖写入，停用时摘掉。 */
  private async applyScheduleJob(schedule: ApiTestScheduleRecord): Promise<void> {
    if (!schedule.enabled) {
      await this.scheduleQueue.removeJobScheduler(schedule.id).catch(() => undefined);
      return;
    }
    await this.scheduleQueue.upsertJobScheduler(
      schedule.id,
      { pattern: schedule.cron, tz: schedule.timezone },
      {
        name: "scheduled-run",
        data: { scheduleId: schedule.id },
        opts: { removeOnComplete: true, removeOnFail: 50 },
      },
    );
  }

  private async assertScheduleTarget(
    targetType: ApiTestScheduleTargetType,
    targetId: string,
  ): Promise<void> {
    if (targetType === "suite") {
      if ((await this.repository.findSuite(this.database, targetId)) === null) {
        throw new ApiError("API_TEST_SCHEDULE_TARGET_INVALID");
      }
      return;
    }
    if ((await this.repository.findCollection(this.database, targetId)) === null) {
      throw new ApiError("API_TEST_SCHEDULE_TARGET_INVALID");
    }
  }

  private async assertEnvironment(environmentId: string): Promise<void> {
    if ((await this.repository.findEnvironment(this.database, environmentId)) === null) {
      throw new ApiError("API_TEST_ENVIRONMENT_NOT_FOUND");
    }
  }

  private async scheduleTargets(
    targetType: ApiTestScheduleTargetType,
    targetId: string,
  ): Promise<ApiTestRunTarget[]> {
    if (targetType === "suite") {
      const suite = await this.repository.findSuite(this.database, targetId);
      if (suite === null) throw new ApiError("API_TEST_SCHEDULE_TARGET_INVALID");
      return [{ suiteId: suite.id, path: suite.path, nodeIds: [] }];
    }
    if ((await this.repository.findCollection(this.database, targetId)) === null) {
      throw new ApiError("API_TEST_SCHEDULE_TARGET_INVALID");
    }
    const items = await this.repository.listCollectionItems(this.database, targetId);
    const targets = groupCollectionTargets(items);
    if (targets.length === 0) throw new ApiError("API_TEST_COLLECTION_EMPTY");
    return targets;
  }
}
