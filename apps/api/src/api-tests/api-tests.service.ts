import {
  ApiTestRepository,
  newId,
  type ApiTestRunItemRecord,
  type ApiTestRunRecord,
  type ApiTestSyncRecord,
  type Database,
} from "@share-mind-map/database";
import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import Redis from "ioredis";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import type { AppConfig } from "../platform/config/app-config.js";
import { APP_CONFIG } from "../platform/config/config.module.js";
import { ApiError } from "../platform/errors/api-error.js";
import type {
  ApiTestEnvironmentResponseDto,
  ApiTestRunDetailResponseDto,
  ApiTestRunItemResponseDto,
  ApiTestRunResponseDto,
  ApiTestSuiteResponseDto,
  ApiTestSyncResponseDto,
} from "./dto/api-test.dto.js";

export const API_TEST_QUEUE = "api-test-run";
export const API_TEST_SYNC_QUEUE = "api-test-sync";

interface ApiTestRunJob {
  runId: string;
}

interface ApiTestSyncJob {
  syncId: string;
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

@Injectable()
export class ApiTestsService implements OnApplicationShutdown {
  private readonly repository = new ApiTestRepository();
  private readonly queue: Queue<ApiTestRunJob>;
  private readonly syncQueue: Queue<ApiTestSyncJob>;
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
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.syncQueue.close();
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

  /** 一次可以选多个套件；按数组顺序入队，worker 单并发保证一条跑完再跑下一条。 */
  public async createRuns(
    auth: AuthContext,
    input: { suiteIds: string[]; environmentId: string },
  ): Promise<ApiTestRunResponseDto[]> {
    const environment = await this.repository.findEnvironment(
      this.database,
      input.environmentId,
    );
    if (environment === null) throw new ApiError("API_TEST_ENVIRONMENT_NOT_FOUND");

    const suites = [];
    for (const suiteId of new Set(input.suiteIds)) {
      const suite = await this.repository.findSuite(this.database, suiteId);
      if (suite === null) throw new ApiError("API_TEST_SUITE_NOT_FOUND");
      suites.push(suite);
    }

    const runs = [];
    for (const suite of suites) {
      const run = await this.repository.createRun(this.database, {
        id: newId(),
        suiteId: suite.id,
        environmentId: environment.id,
        requestedBy: auth.session.userId,
        mode: "suite",
        selection: { path: suite.path },
      });
      await this.queue.add("run", { runId: run.id }, { jobId: run.id });
      runs.push(mapRun(run));
    }
    return runs;
  }

  public async listRuns(limit: number, suiteId?: string): Promise<ApiTestRunResponseDto[]> {
    const runs = await this.repository.listRuns(this.database, limit, suiteId);
    return runs.map(mapRun);
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
}
