import {
  ApiTestRepository,
  newId,
  type ApiTestCollectionExecutionRecord,
  type ApiTestCollectionRecord,
  type ApiTestCollectionSuiteRecord,
  type ApiTestRunItemRecord,
  type ApiTestRunRecord,
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
  ApiTestCollectionDetailResponseDto,
  ApiTestCollectionExecutionResponseDto,
  ApiTestCollectionResponseDto,
  ApiTestCollectionSuiteResponseDto,
  ApiTestEnvironmentResponseDto,
  ApiTestRunDetailResponseDto,
  ApiTestRunItemResponseDto,
  ApiTestRunResponseDto,
  ApiTestScheduleResponseDto,
  ApiTestSuiteResponseDto,
  ApiTestSyncResponseDto,
} from "./dto/api-test.dto.js";

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

function mapCollectionSuite(
  suite: ApiTestCollectionSuiteRecord,
): ApiTestCollectionSuiteResponseDto {
  return {
    suiteId: suite.suiteId,
    key: suite.key,
    name: suite.name,
    path: suite.path,
    enabled: suite.enabled,
    position: suite.position,
    lastRunId: suite.lastRunId,
    lastRunStatus: suite.lastRunStatus,
    totalCount: suite.totalCount,
    passedCount: suite.passedCount,
    failedCount: suite.failedCount,
    skippedCount: suite.skippedCount,
    lastRunAt: suite.lastRunAt?.toISOString() ?? null,
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
    }));
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
   * 一次可以选多个套件；按数组顺序入队，worker 单并发保证一条跑完再跑下一条。
   * 这批 run 共享一个 batchId，报告页据此聚合成一个任务。
   */
  public async createRuns(
    auth: AuthContext,
    input: { suiteIds: string[]; environmentId: string },
  ): Promise<{ batchId: string; runs: ApiTestRunResponseDto[] }> {
    const suites = [];
    for (const suiteId of new Set(input.suiteIds)) {
      const suite = await this.repository.findSuite(this.database, suiteId);
      if (suite === null) throw new ApiError("API_TEST_SUITE_NOT_FOUND");
      suites.push(suite);
    }
    return this.enqueueRuns(
      auth,
      suites.map((suite) => ({ id: suite.id, path: suite.path })),
      input.environmentId,
      null,
    );
  }

  /** 集合和散跑共用：入队顺序就是执行顺序，worker 单并发，一批共享 batchId。 */
  private async enqueueRuns(
    auth: AuthContext,
    suites: { id: string; path: string }[],
    environmentId: string,
    collectionId: string | null,
  ): Promise<{ batchId: string; runs: ApiTestRunResponseDto[] }> {
    const environment = await this.repository.findEnvironment(this.database, environmentId);
    if (environment === null) throw new ApiError("API_TEST_ENVIRONMENT_NOT_FOUND");

    const batchId = newId();
    const runs = [];
    for (const suite of suites) {
      const run = await this.repository.createRun(this.database, {
        id: newId(),
        suiteId: suite.id,
        environmentId: environment.id,
        requestedBy: auth.session.userId,
        mode: "suite",
        selection: { path: suite.path },
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
    const suites = await this.repository.listCollectionSuites(this.database, collectionId);
    return Object.assign(mapCollection(collection), { suites: suites.map(mapCollectionSuite) });
  }

  public async createCollection(
    auth: AuthContext,
    input: { name: string; description: string; suiteIds: string[] },
  ): Promise<ApiTestCollectionDetailResponseDto> {
    const name = input.name.trim();
    if (name === "") throw new ApiError("API_TEST_COLLECTION_NAME_INVALID");
    const suites = await this.resolveSuites(input.suiteIds);
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
    await this.repository.replaceCollectionSuites(
      this.database,
      created.id,
      suites.map((suite) => suite.id),
    );
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

  public async setCollectionSuites(
    collectionId: string,
    suiteIds: string[],
  ): Promise<ApiTestCollectionDetailResponseDto> {
    const collection = await this.repository.findCollection(this.database, collectionId);
    if (collection === null) throw new ApiError("API_TEST_COLLECTION_NOT_FOUND");
    const suites = await this.resolveSuites(suiteIds);
    await this.repository.replaceCollectionSuites(
      this.database,
      collectionId,
      suites.map((suite) => suite.id),
    );
    return this.getCollection(collectionId);
  }

  public async runCollection(
    auth: AuthContext,
    collectionId: string,
    environmentId: string,
  ): Promise<{ batchId: string; runs: ApiTestRunResponseDto[] }> {
    const collection = await this.repository.findCollection(this.database, collectionId);
    if (collection === null) throw new ApiError("API_TEST_COLLECTION_NOT_FOUND");
    const suites = await this.repository.listCollectionSuites(this.database, collectionId);
    const runnable = suites.filter((suite) => suite.enabled);
    if (runnable.length === 0) throw new ApiError("API_TEST_COLLECTION_EMPTY");
    return this.enqueueRuns(
      auth,
      runnable.map((suite) => ({ id: suite.suiteId, path: suite.path })),
      environmentId,
      collectionId,
    );
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

  /** 重复、不存在的套件 id 都按「套件不存在」处理：集合里只放同步得到的套件。 */
  private async resolveSuites(
    suiteIds: string[],
  ): Promise<{ id: string; path: string }[]> {
    const suites = [];
    for (const suiteId of new Set(suiteIds)) {
      const suite = await this.repository.findSuite(this.database, suiteId);
      if (suite === null) throw new ApiError("API_TEST_SUITE_NOT_FOUND");
      suites.push({ id: suite.id, path: suite.path });
    }
    return suites;
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

  /** 只有手动触发：前端点「同步用例」。 */
  public async syncRepository(requestedBy: string | null): Promise<ApiTestSyncResponseDto> {
    const active = await this.repository.findActiveSync(this.database);
    if (active !== null) throw new ApiError("API_TEST_SYNC_IN_PROGRESS");
    const sync = await this.repository.createSync(this.database, {
      id: newId(),
      branch: "main",
      trigger: "manual",
      requestedBy,
    });
    await this.syncQueue.add("sync", { syncId: sync.id }, { jobId: sync.id });
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
    const suites = await this.scheduleSuites(schedule.targetType, schedule.targetId);
    const result = await this.enqueueRuns(
      auth,
      suites,
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

  private async scheduleSuites(
    targetType: ApiTestScheduleTargetType,
    targetId: string,
  ): Promise<{ id: string; path: string }[]> {
    if (targetType === "suite") {
      const suite = await this.repository.findSuite(this.database, targetId);
      if (suite === null) throw new ApiError("API_TEST_SCHEDULE_TARGET_INVALID");
      return [{ id: suite.id, path: suite.path }];
    }
    if ((await this.repository.findCollection(this.database, targetId)) === null) {
      throw new ApiError("API_TEST_SCHEDULE_TARGET_INVALID");
    }
    const suites = await this.repository.listCollectionSuites(this.database, targetId);
    const runnable = suites.filter((suite) => suite.enabled);
    if (runnable.length === 0) throw new ApiError("API_TEST_COLLECTION_EMPTY");
    return runnable.map((suite) => ({ id: suite.suiteId, path: suite.path }));
  }
}
