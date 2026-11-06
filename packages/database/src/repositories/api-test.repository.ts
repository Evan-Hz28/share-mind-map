import { sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { newId } from "../id.js";

export type ApiTestRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ApiTestItemStatus = "passed" | "failed" | "skipped" | "error";
export type ApiTestSyncStatus = "queued" | "running" | "succeeded" | "failed";
export type ApiTestSyncTrigger = "manual" | "webhook" | "schedule";

export interface ApiTestSyncRecord {
  id: string;
  branch: string;
  status: ApiTestSyncStatus;
  trigger: ApiTestSyncTrigger;
  requestedBy: string | null;
  commitSha: string | null;
  previousSha: string | null;
  changedFiles: number;
  suitesAdded: number;
  suitesRemoved: number;
  requirementsChanged: boolean;
  message: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface ApiTestEnvironmentRecord {
  id: string;
  key: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  createdAt: Date;
}

export interface ApiTestSuiteRecord {
  id: string;
  key: string;
  name: string;
  path: string;
  enabled: boolean;
  createdAt: Date;
}

export interface ApiTestRunRecord {
  id: string;
  suiteId: string;
  suiteKey: string;
  suiteName: string;
  suitePath: string;
  environmentId: string;
  environmentKey: string;
  environmentName: string;
  environmentBaseUrl: string;
  requestedBy: string;
  mode: "suite" | "selected";
  /** 同一次多选执行共享一个批次；老记录为空。 */
  batchId: string | null;
  /** 从集合发起时记下集合；散跑为空。 */
  collectionId: string | null;
  repoCommit: string | null;
  status: ApiTestRunStatus;
  cancelRequested: boolean;
  totalCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface ApiTestRunItemRecord {
  id: string;
  runId: string;
  nodeId: string;
  caseName: string;
  ordinal: number;
  status: ApiTestItemStatus;
  durationMs: number | null;
  failure: string | null;
  request: unknown;
  response: unknown;
  createdAt: Date;
}

export interface ApiTestCollectionRecord {
  id: string;
  name: string;
  description: string;
  suiteCount: number;
  /** 各套件最近一次执行的用例数之和；没跑过的按 0 算。 */
  caseCount: number;
  lastRunAt: Date | null;
  lastRunStatus: ApiTestRunStatus | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiTestCollectionSuiteRecord {
  suiteId: string;
  key: string;
  name: string;
  path: string;
  enabled: boolean;
  position: number;
  lastRunId: string | null;
  lastRunStatus: ApiTestRunStatus | null;
  totalCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  lastRunAt: Date | null;
}

/** 一次集合执行 = 一个批次，执行记录按批次聚合，不按单套件铺开。 */
export interface ApiTestCollectionExecutionRecord {
  batchId: string;
  status: ApiTestRunStatus;
  suiteCount: number;
  totalCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export type ApiTestScheduleTargetType = "suite" | "collection";

/** 定时任务：库里存 cron，Redis 里的 Job Scheduler 是按这张表重建的副本。 */
export interface ApiTestScheduleRecord {
  id: string;
  name: string;
  targetType: ApiTestScheduleTargetType;
  targetId: string;
  /** 目标被同步任务停用或删除时为空，前端据此提示重建。 */
  targetName: string | null;
  targetPath: string | null;
  environmentId: string;
  environmentName: string | null;
  environmentKey: string | null;
  cron: string;
  timezone: string;
  syncBeforeRun: boolean;
  enabled: boolean;
  nextRunAt: Date | null;
  lastBatchId: string | null;
  lastRunAt: Date | null;
  lastRunStatus: ApiTestRunStatus | null;
  lastTotalCount: number;
  lastPassedCount: number;
  lastFailedCount: number;
  lastSkippedCount: number;
  lastError: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SuiteRow extends Record<string, unknown> {
  id: string;
  key: string;
  name: string;
  path: string;
  enabled: boolean;
  created_at: Date | string;
}

interface EnvironmentRow extends Record<string, unknown> {
  id: string;
  key: string;
  name: string;
  base_url: string;
  enabled: boolean;
  created_at: Date | string;
}

interface RunRow extends Record<string, unknown> {
  id: string;
  suite_id: string;
  suite_key: string;
  suite_name: string;
  suite_path: string;
  environment_id: string;
  environment_key: string;
  environment_name: string;
  environment_base_url: string;
  requested_by: string;
  mode: "suite" | "selected";
  batch_id: string | null;
  collection_id: string | null;
  repo_commit: string | null;
  status: ApiTestRunStatus;
  cancel_requested: boolean;
  total_count: number;
  passed_count: number;
  failed_count: number;
  skipped_count: number;
  error_message: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

interface ItemRow extends Record<string, unknown> {
  id: string;
  run_id: string;
  node_id: string;
  case_name: string;
  ordinal: number;
  status: ApiTestItemStatus;
  duration_ms: number | null;
  failure: string | null;
  request: unknown;
  response: unknown;
  created_at: Date | string;
}

interface CollectionRow extends Record<string, unknown> {
  id: string;
  name: string;
  description: string;
  suite_count: number;
  case_count: number;
  last_run_at: Date | string | null;
  last_run_status: ApiTestRunStatus | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CollectionSuiteRow extends Record<string, unknown> {
  suite_id: string;
  key: string;
  name: string;
  path: string;
  enabled: boolean;
  position: number;
  last_run_id: string | null;
  last_run_status: ApiTestRunStatus | null;
  total_count: number | null;
  passed_count: number | null;
  failed_count: number | null;
  skipped_count: number | null;
  last_run_at: Date | string | null;
}

interface ExecutionRow extends Record<string, unknown> {
  batch_id: string;
  status: ApiTestRunStatus;
  suite_count: number;
  total_count: number;
  passed_count: number;
  failed_count: number;
  skipped_count: number;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
}

interface ScheduleRow extends Record<string, unknown> {
  id: string;
  name: string;
  target_type: ApiTestScheduleTargetType;
  target_id: string;
  target_name: string | null;
  target_path: string | null;
  environment_id: string;
  environment_name: string | null;
  environment_key: string | null;
  cron: string;
  timezone: string;
  sync_before_run: boolean;
  enabled: boolean;
  next_run_at: Date | string | null;
  last_batch_id: string | null;
  last_run_at: Date | string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_status: ApiTestRunStatus | null;
  last_total_count: number | null;
  last_passed_count: number | null;
  last_failed_count: number | null;
  last_skipped_count: number | null;
}

interface SyncRow extends Record<string, unknown> {
  id: string;
  branch: string;
  status: ApiTestSyncStatus;
  trigger: ApiTestSyncTrigger;
  requested_by: string | null;
  commit_sha: string | null;
  previous_sha: string | null;
  changed_files: number;
  suites_added: number;
  suites_removed: number;
  requirements_changed: boolean;
  message: string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
}

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function toSuite(row: SuiteRow): ApiTestSuiteRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    path: row.path,
    enabled: row.enabled,
    createdAt: asDate(row.created_at) as Date,
  };
}

function toEnvironment(row: EnvironmentRow): ApiTestEnvironmentRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    baseUrl: row.base_url,
    enabled: row.enabled,
    createdAt: asDate(row.created_at) as Date,
  };
}

function toRun(row: RunRow): ApiTestRunRecord {
  return {
    id: row.id,
    suiteId: row.suite_id,
    suiteKey: row.suite_key,
    suiteName: row.suite_name,
    suitePath: row.suite_path,
    environmentId: row.environment_id,
    environmentKey: row.environment_key,
    environmentName: row.environment_name,
    environmentBaseUrl: row.environment_base_url,
    requestedBy: row.requested_by,
    mode: row.mode,
    batchId: row.batch_id,
    collectionId: row.collection_id,
    repoCommit: row.repo_commit,
    status: row.status,
    cancelRequested: row.cancel_requested,
    totalCount: row.total_count,
    passedCount: row.passed_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
    errorMessage: row.error_message,
    createdAt: asDate(row.created_at) as Date,
    startedAt: asDate(row.started_at),
    finishedAt: asDate(row.finished_at),
  };
}

function toItem(row: ItemRow): ApiTestRunItemRecord {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    caseName: row.case_name,
    ordinal: row.ordinal,
    status: row.status,
    durationMs: row.duration_ms,
    failure: row.failure,
    request: row.request,
    response: row.response,
    createdAt: asDate(row.created_at) as Date,
  };
}

function toCollection(row: CollectionRow): ApiTestCollectionRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    suiteCount: row.suite_count,
    caseCount: row.case_count,
    lastRunAt: asDate(row.last_run_at),
    lastRunStatus: row.last_run_status,
    createdAt: asDate(row.created_at) as Date,
    updatedAt: asDate(row.updated_at) as Date,
  };
}

function toCollectionSuite(row: CollectionSuiteRow): ApiTestCollectionSuiteRecord {
  return {
    suiteId: row.suite_id,
    key: row.key,
    name: row.name,
    path: row.path,
    enabled: row.enabled,
    position: row.position,
    lastRunId: row.last_run_id,
    lastRunStatus: row.last_run_status,
    totalCount: row.total_count ?? 0,
    passedCount: row.passed_count ?? 0,
    failedCount: row.failed_count ?? 0,
    skippedCount: row.skipped_count ?? 0,
    lastRunAt: asDate(row.last_run_at),
  };
}

function toExecution(row: ExecutionRow): ApiTestCollectionExecutionRecord {
  return {
    batchId: row.batch_id,
    status: row.status,
    suiteCount: row.suite_count,
    totalCount: row.total_count,
    passedCount: row.passed_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
    startedAt: asDate(row.started_at),
    finishedAt: asDate(row.finished_at),
    createdAt: asDate(row.created_at) as Date,
  };
}

function toSchedule(row: ScheduleRow): ApiTestScheduleRecord {
  return {
    id: row.id,
    name: row.name,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name,
    targetPath: row.target_path,
    environmentId: row.environment_id,
    environmentName: row.environment_name,
    environmentKey: row.environment_key,
    cron: row.cron,
    timezone: row.timezone,
    syncBeforeRun: row.sync_before_run,
    enabled: row.enabled,
    nextRunAt: asDate(row.next_run_at),
    lastBatchId: row.last_batch_id,
    lastRunAt: asDate(row.last_run_at),
    lastRunStatus: row.last_status,
    lastTotalCount: row.last_total_count ?? 0,
    lastPassedCount: row.last_passed_count ?? 0,
    lastFailedCount: row.last_failed_count ?? 0,
    lastSkippedCount: row.last_skipped_count ?? 0,
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: asDate(row.created_at) as Date,
    updatedAt: asDate(row.updated_at) as Date,
  };
}

function toSync(row: SyncRow): ApiTestSyncRecord {
  return {
    id: row.id,
    branch: row.branch,
    status: row.status,
    trigger: row.trigger,
    requestedBy: row.requested_by,
    commitSha: row.commit_sha,
    previousSha: row.previous_sha,
    changedFiles: row.changed_files,
    suitesAdded: row.suites_added,
    suitesRemoved: row.suites_removed,
    requirementsChanged: row.requirements_changed,
    message: row.message,
    startedAt: asDate(row.started_at),
    finishedAt: asDate(row.finished_at),
    createdAt: asDate(row.created_at) as Date,
  };
}

const syncColumns = sql.raw(`
  id, branch, status, trigger, requested_by, commit_sha, previous_sha,
  changed_files, suites_added, suites_removed, requirements_changed,
  message, started_at, finished_at, created_at
`);

const runColumns = sql.raw(`
  r.id, r.suite_id, s.key AS suite_key, s.name AS suite_name, s.path AS suite_path,
  r.environment_id, e.key AS environment_key, e.name AS environment_name,
  e.base_url AS environment_base_url,
  r.requested_by, r.mode, r.batch_id, r.collection_id, r.repo_commit,
  r.status, r.cancel_requested,
  r.total_count, r.passed_count, r.failed_count, r.skipped_count,
  r.error_message, r.created_at, r.started_at, r.finished_at
`);

const itemColumns = sql.raw(`
  id, run_id, node_id, case_name, ordinal, status, duration_ms, failure,
  request, response, created_at
`);

/** 目标名、环境名和上次结果都 join 出来，列表页一次查询就够。 */
const scheduleSelect = sql.raw(`
  SELECT s.id, s.name, s.target_type, s.target_id,
         COALESCE(su.name, c.name) AS target_name,
         su.path AS target_path,
         s.environment_id, e.name AS environment_name, e.key AS environment_key,
         s.cron, s.timezone, s.sync_before_run, s.enabled,
         s.next_run_at, s.last_batch_id, s.last_run_at, s.last_error,
         s.created_by, s.created_at, s.updated_at,
         agg.last_status, agg.last_total_count, agg.last_passed_count,
         agg.last_failed_count, agg.last_skipped_count
  FROM api_test_schedules s
  LEFT JOIN api_test_suites su ON s.target_type = 'suite' AND su.id = s.target_id
  LEFT JOIN api_test_collections c ON s.target_type = 'collection' AND c.id = s.target_id
  LEFT JOIN api_test_environments e ON e.id = s.environment_id
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN count(*) = 0 THEN NULL::text
             WHEN bool_or(r.status IN ('queued', 'running')) THEN 'running'
             WHEN bool_or(r.status IN ('failed', 'cancelled')) THEN 'failed'
             ELSE 'succeeded'
           END AS last_status,
           COALESCE(SUM(r.total_count), 0)::int AS last_total_count,
           COALESCE(SUM(r.passed_count), 0)::int AS last_passed_count,
           COALESCE(SUM(r.failed_count), 0)::int AS last_failed_count,
           COALESCE(SUM(r.skipped_count), 0)::int AS last_skipped_count
    FROM api_test_runs r
    WHERE r.batch_id = s.last_batch_id
  ) agg ON s.last_batch_id IS NOT NULL
`);

export class ApiTestRepository {
  public async listSuites(database: Database): Promise<ApiTestSuiteRecord[]> {
    const result = await database.execute<SuiteRow>(sql`
      SELECT id, key, name, path, enabled, created_at
      FROM api_test_suites
      WHERE enabled = true
      ORDER BY key
    `);
    return result.rows.map(toSuite);
  }

  public async listEnvironments(database: Database): Promise<ApiTestEnvironmentRecord[]> {
    const result = await database.execute<EnvironmentRow>(sql`
      SELECT id, key, name, base_url, enabled, created_at
      FROM api_test_environments
      WHERE enabled = true
      ORDER BY key
    `);
    return result.rows.map(toEnvironment);
  }

  public async findSuite(database: Database, id: string): Promise<ApiTestSuiteRecord | null> {
    const result = await database.execute<SuiteRow>(sql`
      SELECT id, key, name, path, enabled, created_at
      FROM api_test_suites
      WHERE id = ${id} AND enabled = true
    `);
    const row = result.rows[0];
    return row === undefined ? null : toSuite(row);
  }

  public async findEnvironment(
    database: Database,
    id: string,
  ): Promise<ApiTestEnvironmentRecord | null> {
    const result = await database.execute<EnvironmentRow>(sql`
      SELECT id, key, name, base_url, enabled, created_at
      FROM api_test_environments
      WHERE id = ${id} AND enabled = true
    `);
    const row = result.rows[0];
    return row === undefined ? null : toEnvironment(row);
  }

  public async createRun(
    database: Database,
    input: {
      id: string;
      suiteId: string;
      environmentId: string;
      requestedBy: string;
      mode: "suite" | "selected";
      selection: unknown;
      batchId?: string | null;
      collectionId?: string | null;
    },
  ): Promise<ApiTestRunRecord> {
    await database.execute(sql`
      INSERT INTO api_test_runs (
        id, suite_id, environment_id, requested_by, mode, selection, status,
        batch_id, collection_id
      )
      VALUES (
        ${input.id}, ${input.suiteId}, ${input.environmentId}, ${input.requestedBy},
        ${input.mode}, ${JSON.stringify(input.selection)}::jsonb, 'queued',
        ${input.batchId ?? null}, ${input.collectionId ?? null}
      )
    `);
    const run = await this.findRun(database, input.id);
    if (run === null) throw new Error("api test run insert failed");
    return run;
  }

  public async findRun(database: Database, id: string): Promise<ApiTestRunRecord | null> {
    const result = await database.execute<RunRow>(sql`
      SELECT ${runColumns}
      FROM api_test_runs r
      JOIN api_test_suites s ON s.id = r.suite_id
      JOIN api_test_environments e ON e.id = r.environment_id
      WHERE r.id = ${id}
    `);
    const row = result.rows[0];
    return row === undefined ? null : toRun(row);
  }

  /** suiteId / batchId 都不传返回全部；详情页、执行记录页、批次报告页共用这一条查询。 */
  public async listRuns(
    database: Database,
    limit: number,
    filter: { suiteId?: string; batchId?: string } = {},
  ): Promise<ApiTestRunRecord[]> {
    const suiteFilter =
      filter.suiteId === undefined ? sql`true` : sql`r.suite_id = ${filter.suiteId}`;
    const batchFilter =
      filter.batchId === undefined ? sql`true` : sql`r.batch_id = ${filter.batchId}`;
    const result = await database.execute<RunRow>(sql`
      SELECT ${runColumns}
      FROM api_test_runs r
      JOIN api_test_suites s ON s.id = r.suite_id
      JOIN api_test_environments e ON e.id = r.environment_id
      WHERE ${suiteFilter} AND ${batchFilter}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${Math.min(Math.max(limit, 1), 100)}
    `);
    return result.rows.map(toRun);
  }

  /** 批次内按入队顺序返回，报告页照这个顺序分组展示。 */
  public async listRunsByBatch(
    database: Database,
    batchId: string,
  ): Promise<ApiTestRunRecord[]> {
    const result = await database.execute<RunRow>(sql`
      SELECT ${runColumns}
      FROM api_test_runs r
      JOIN api_test_suites s ON s.id = r.suite_id
      JOIN api_test_environments e ON e.id = r.environment_id
      WHERE r.batch_id = ${batchId}
      ORDER BY r.created_at, r.id
    `);
    return result.rows.map(toRun);
  }

  public async listCollections(database: Database): Promise<ApiTestCollectionRecord[]> {
    const result = await database.execute<CollectionRow>(sql`
      SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
             COALESCE(agg.suite_count, 0) AS suite_count,
             COALESCE(agg.case_count, 0) AS case_count,
             agg.last_run_at, agg.last_run_status
      FROM api_test_collections c
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS suite_count,
               COALESCE(SUM(latest.total_count), 0)::int AS case_count,
               MAX(latest.created_at) AS last_run_at,
               (ARRAY_AGG(latest.status ORDER BY latest.created_at DESC))[1] AS last_run_status
        FROM api_test_collection_suites cs
        LEFT JOIN LATERAL (
          SELECT r.total_count, r.created_at, r.status
          FROM api_test_runs r
          WHERE r.suite_id = cs.suite_id
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT 1
        ) latest ON true
        WHERE cs.collection_id = c.id
      ) agg ON true
      ORDER BY c.updated_at DESC, c.id DESC
    `);
    return result.rows.map(toCollection);
  }

  public async findCollection(
    database: Database,
    id: string,
  ): Promise<ApiTestCollectionRecord | null> {
    const result = await database.execute<CollectionRow>(sql`
      SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
             COALESCE(agg.suite_count, 0) AS suite_count,
             COALESCE(agg.case_count, 0) AS case_count,
             agg.last_run_at, agg.last_run_status
      FROM api_test_collections c
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS suite_count,
               COALESCE(SUM(latest.total_count), 0)::int AS case_count,
               MAX(latest.created_at) AS last_run_at,
               (ARRAY_AGG(latest.status ORDER BY latest.created_at DESC))[1] AS last_run_status
        FROM api_test_collection_suites cs
        LEFT JOIN LATERAL (
          SELECT r.total_count, r.created_at, r.status
          FROM api_test_runs r
          WHERE r.suite_id = cs.suite_id
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT 1
        ) latest ON true
        WHERE cs.collection_id = c.id
      ) agg ON true
      WHERE c.id = ${id}
    `);
    const row = result.rows[0];
    return row === undefined ? null : toCollection(row);
  }

  public async createCollection(
    database: Database,
    input: { id: string; name: string; description: string; createdBy: string },
  ): Promise<ApiTestCollectionRecord> {
    await database.execute(sql`
      INSERT INTO api_test_collections (id, name, description, created_by)
      VALUES (${input.id}, ${input.name}, ${input.description}, ${input.createdBy})
    `);
    const collection = await this.findCollection(database, input.id);
    if (collection === null) throw new Error("api test collection insert failed");
    return collection;
  }

  public async updateCollection(
    database: Database,
    id: string,
    input: { name: string; description: string },
  ): Promise<ApiTestCollectionRecord | null> {
    const result = await database.execute<{ id: string }>(sql`
      UPDATE api_test_collections
      SET name = ${input.name}, description = ${input.description}, updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `);
    if (result.rows.length === 0) return null;
    return this.findCollection(database, id);
  }

  public async deleteCollection(database: Database, id: string): Promise<boolean> {
    const result = await database.execute<{ id: string }>(sql`
      DELETE FROM api_test_collections WHERE id = ${id} RETURNING id
    `);
    return result.rows.length > 0;
  }

  /** 成员整体替换：集合成员不多，重建比逐条 diff 简单，也天然处理顺序。 */
  public async replaceCollectionSuites(
    database: Database,
    collectionId: string,
    suiteIds: string[],
  ): Promise<void> {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`DELETE FROM api_test_collection_suites WHERE collection_id = ${collectionId}`,
      );
      for (const [position, suiteId] of suiteIds.entries()) {
        await transaction.execute(sql`
          INSERT INTO api_test_collection_suites (collection_id, suite_id, position)
          VALUES (${collectionId}, ${suiteId}, ${position})
          ON CONFLICT (collection_id, suite_id) DO NOTHING
        `);
      }
      await transaction.execute(
        sql`UPDATE api_test_collections SET updated_at = now() WHERE id = ${collectionId}`,
      );
    });
  }

  public async listCollectionSuites(
    database: Database,
    collectionId: string,
  ): Promise<ApiTestCollectionSuiteRecord[]> {
    const result = await database.execute<CollectionSuiteRow>(sql`
      SELECT s.id AS suite_id, s.key, s.name, s.path, s.enabled, cs.position,
             latest.id AS last_run_id, latest.status AS last_run_status,
             latest.total_count, latest.passed_count, latest.failed_count,
             latest.skipped_count, latest.created_at AS last_run_at
      FROM api_test_collection_suites cs
      JOIN api_test_suites s ON s.id = cs.suite_id
      LEFT JOIN LATERAL (
        SELECT r.id, r.status, r.total_count, r.passed_count, r.failed_count,
               r.skipped_count, r.created_at
        FROM api_test_runs r
        WHERE r.suite_id = s.id
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1
      ) latest ON true
      WHERE cs.collection_id = ${collectionId}
      ORDER BY cs.position, s.name
    `);
    return result.rows.map(toCollectionSuite);
  }

  /** 执行记录按批次聚合：一次执行集合就是一批，不能按套件铺成 N 行。 */
  public async listCollectionExecutions(
    database: Database,
    collectionId: string,
    limit: number,
  ): Promise<ApiTestCollectionExecutionRecord[]> {
    const result = await database.execute<ExecutionRow>(sql`
      SELECT r.batch_id,
             CASE
               WHEN bool_or(r.status IN ('queued', 'running')) THEN 'running'
               WHEN bool_or(r.status IN ('failed', 'cancelled')) THEN 'failed'
               ELSE 'succeeded'
             END AS status,
             count(*)::int AS suite_count,
             COALESCE(SUM(r.total_count), 0)::int AS total_count,
             COALESCE(SUM(r.passed_count), 0)::int AS passed_count,
             COALESCE(SUM(r.failed_count), 0)::int AS failed_count,
             COALESCE(SUM(r.skipped_count), 0)::int AS skipped_count,
             MIN(r.started_at) AS started_at,
             MAX(r.finished_at) AS finished_at,
             MIN(r.created_at) AS created_at
      FROM api_test_runs r
      WHERE r.collection_id = ${collectionId} AND r.batch_id IS NOT NULL
      GROUP BY r.batch_id
      ORDER BY MIN(r.created_at) DESC
      LIMIT ${Math.min(Math.max(limit, 1), 100)}
    `);
    return result.rows.map(toExecution);
  }

  public async listRunItems(
    database: Database,
    runId: string,
  ): Promise<ApiTestRunItemRecord[]> {
    const result = await database.execute<ItemRow>(sql`
      SELECT ${itemColumns}
      FROM api_test_run_items
      WHERE run_id = ${runId}
      ORDER BY ordinal, id
    `);
    return result.rows.map(toItem);
  }

  /** 只有 queued 才能进入 running，防止取消与启动竞争时把已取消的 run 重开。 */
  public async markRunning(database: Database, runId: string): Promise<boolean> {
    const result = await database.execute<{ id: string }>(sql`
      UPDATE api_test_runs
      SET status = 'running', started_at = now()
      WHERE id = ${runId} AND status = 'queued'
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  public async insertItem(
    database: Database,
    item: {
      runId: string;
      nodeId: string;
      caseName: string;
      ordinal: number;
      status: ApiTestItemStatus;
      durationMs: number | null;
      failure: string | null;
      request: unknown;
      response: unknown;
    },
  ): Promise<void> {
    await database.execute(sql`
      INSERT INTO api_test_run_items (
        id, run_id, node_id, case_name, ordinal, status, duration_ms, failure, request, response
      )
      VALUES (
        ${newId()}, ${item.runId}, ${item.nodeId}, ${item.caseName}, ${item.ordinal},
        ${item.status}, ${item.durationMs}, ${item.failure},
        ${item.request === undefined ? null : JSON.stringify(item.request)}::jsonb,
        ${item.response === undefined ? null : JSON.stringify(item.response)}::jsonb
      )
      ON CONFLICT (run_id, node_id) DO NOTHING
    `);
  }

  public async finishRun(
    database: Database,
    runId: string,
    status: Exclude<ApiTestRunStatus, "queued" | "running">,
    errorMessage: string | null,
  ): Promise<void> {
    await database.execute(sql`
      WITH counts AS (
        SELECT
          count(*)::int AS total_count,
          count(*) FILTER (WHERE status = 'passed')::int AS passed_count,
          count(*) FILTER (WHERE status IN ('failed', 'error'))::int AS failed_count,
          count(*) FILTER (WHERE status = 'skipped')::int AS skipped_count
        FROM api_test_run_items
        WHERE run_id = ${runId}
      )
      UPDATE api_test_runs r
      SET status = ${status},
          error_message = ${errorMessage},
          finished_at = now(),
          total_count = counts.total_count,
          passed_count = counts.passed_count,
          failed_count = counts.failed_count,
          skipped_count = counts.skipped_count
      FROM counts
      WHERE r.id = ${runId}
    `);
  }

  public async requestCancel(database: Database, runId: string): Promise<boolean> {
    const result = await database.execute<{ id: string }>(sql`
      UPDATE api_test_runs
      SET cancel_requested = true
      WHERE id = ${runId} AND status IN ('queued', 'running')
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  public async isCancelRequested(database: Database, runId: string): Promise<boolean> {
    const result = await database.execute<{ cancel_requested: boolean }>(sql`
      SELECT cancel_requested FROM api_test_runs WHERE id = ${runId}
    `);
    return result.rows[0]?.cancel_requested === true;
  }

  public async markCancelled(database: Database, runId: string): Promise<void> {
    await this.finishRun(database, runId, "cancelled", null);
  }

  /** 记录本次执行用的仓库 commit，报告才能回溯到具体代码版本。 */
  public async setRunRepoCommit(
    database: Database,
    runId: string,
    commit: string | null,
  ): Promise<void> {
    await database.execute(sql`
      UPDATE api_test_runs SET repo_commit = ${commit} WHERE id = ${runId}
    `);
  }

  public async listSuitePaths(database: Database): Promise<string[]> {
    const result = await database.execute<{ path: string }>(sql`
      SELECT path FROM api_test_suites
    `);
    return result.rows.map((row) => row.path);
  }

  public async createSync(
    database: Database,
    input: {
      id: string;
      branch: string;
      trigger: ApiTestSyncTrigger;
      requestedBy: string | null;
    },
  ): Promise<ApiTestSyncRecord> {
    await database.execute(sql`
      INSERT INTO api_test_syncs (id, branch, trigger, requested_by)
      VALUES (${input.id}, ${input.branch}, ${input.trigger}, ${input.requestedBy})
    `);
    const sync = await this.findSync(database, input.id);
    if (sync === null) throw new Error("api test sync insert failed");
    return sync;
  }

  public async findSync(database: Database, id: string): Promise<ApiTestSyncRecord | null> {
    const result = await database.execute<SyncRow>(sql`
      SELECT ${syncColumns} FROM api_test_syncs WHERE id = ${id}
    `);
    const row = result.rows[0];
    return row === undefined ? null : toSync(row);
  }

  public async listSyncs(database: Database, limit: number): Promise<ApiTestSyncRecord[]> {
    const result = await database.execute<SyncRow>(sql`
      SELECT ${syncColumns}
      FROM api_test_syncs
      ORDER BY created_at DESC, id DESC
      LIMIT ${Math.min(Math.max(limit, 1), 50)}
    `);
    return result.rows.map(toSync);
  }

  /** 同一时间只允许一个同步任务，避免两个 job 同时 reset 工作区。 */
  public async findActiveSync(database: Database): Promise<ApiTestSyncRecord | null> {
    const result = await database.execute<SyncRow>(sql`
      SELECT ${syncColumns}
      FROM api_test_syncs
      WHERE status IN ('queued', 'running')
      ORDER BY created_at ASC
      LIMIT 1
    `);
    const row = result.rows[0];
    return row === undefined ? null : toSync(row);
  }

  public async markSyncRunning(database: Database, id: string): Promise<boolean> {
    const result = await database.execute<{ id: string }>(sql`
      UPDATE api_test_syncs
      SET status = 'running', started_at = now()
      WHERE id = ${id} AND status = 'queued'
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  public async finishSync(
    database: Database,
    id: string,
    input: {
      status: Exclude<ApiTestSyncStatus, "queued" | "running">;
      commitSha: string | null;
      previousSha: string | null;
      changedFiles: number;
      suitesAdded: number;
      suitesRemoved: number;
      requirementsChanged: boolean;
      message: string | null;
    },
  ): Promise<void> {
    await database.execute(sql`
      UPDATE api_test_syncs
      SET status = ${input.status},
          commit_sha = ${input.commitSha},
          previous_sha = ${input.previousSha},
          changed_files = ${input.changedFiles},
          suites_added = ${input.suitesAdded},
          suites_removed = ${input.suitesRemoved},
          requirements_changed = ${input.requirementsChanged},
          message = ${input.message},
          finished_at = now()
      WHERE id = ${id}
    `);
  }

  /** 按仓库相对路径入库；key 保持稳定，名称跟着目录走，历史手工命名会被覆盖。 */
  public async upsertDiscoveredSuite(
    database: Database,
    input: { id: string; key: string; name: string; path: string; commit: string },
  ): Promise<boolean> {
    const result = await database.execute<{ inserted: boolean }>(sql`
      INSERT INTO api_test_suites (id, key, name, path, discovered, last_seen_commit)
      VALUES (${input.id}, ${input.key}, ${input.name}, ${input.path}, true, ${input.commit})
      ON CONFLICT (path) DO UPDATE
        SET discovered = true,
            name = excluded.name,
            last_seen_commit = excluded.last_seen_commit,
            enabled = true
      RETURNING (xmax = 0) AS inserted
    `);
    return result.rows[0]?.inserted === true;
  }

  public async listSchedules(database: Database): Promise<ApiTestScheduleRecord[]> {
    const result = await database.execute<ScheduleRow>(sql`
      ${scheduleSelect}
      ORDER BY s.enabled DESC, s.next_run_at ASC NULLS LAST, s.created_at DESC
    `);
    return result.rows.map(toSchedule);
  }

  public async findSchedule(
    database: Database,
    id: string,
  ): Promise<ApiTestScheduleRecord | null> {
    const result = await database.execute<ScheduleRow>(sql`
      ${scheduleSelect}
      WHERE s.id = ${id}
    `);
    const row = result.rows[0];
    return row === undefined ? null : toSchedule(row);
  }

  public async createSchedule(
    database: Database,
    input: {
      id: string;
      name: string;
      targetType: ApiTestScheduleTargetType;
      targetId: string;
      environmentId: string;
      cron: string;
      timezone: string;
      syncBeforeRun: boolean;
      enabled: boolean;
      nextRunAt: Date | null;
      createdBy: string;
    },
  ): Promise<ApiTestScheduleRecord> {
    await database.execute(sql`
      INSERT INTO api_test_schedules (
        id, name, target_type, target_id, environment_id, cron, timezone,
        sync_before_run, enabled, next_run_at, created_by
      )
      VALUES (
        ${input.id}, ${input.name}, ${input.targetType}, ${input.targetId},
        ${input.environmentId}, ${input.cron}, ${input.timezone},
        ${input.syncBeforeRun}, ${input.enabled}, ${input.nextRunAt}, ${input.createdBy}
      )
    `);
    const schedule = await this.findSchedule(database, input.id);
    if (schedule === null) throw new Error("api test schedule insert failed");
    return schedule;
  }

  /** 整体覆盖：改名、换目标、换环境、改周期都走这一条，避免字段散落。 */
  public async updateSchedule(
    database: Database,
    id: string,
    input: {
      name: string;
      targetType: ApiTestScheduleTargetType;
      targetId: string;
      environmentId: string;
      cron: string;
      timezone: string;
      syncBeforeRun: boolean;
      enabled: boolean;
      nextRunAt: Date | null;
    },
  ): Promise<ApiTestScheduleRecord | null> {
    const result = await database.execute<{ id: string }>(sql`
      UPDATE api_test_schedules
      SET name = ${input.name},
          target_type = ${input.targetType},
          target_id = ${input.targetId},
          environment_id = ${input.environmentId},
          cron = ${input.cron},
          timezone = ${input.timezone},
          sync_before_run = ${input.syncBeforeRun},
          enabled = ${input.enabled},
          next_run_at = ${input.nextRunAt},
          last_error = NULL,
          updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `);
    if (result.rows.length === 0) return null;
    return this.findSchedule(database, id);
  }

  public async setScheduleEnabled(
    database: Database,
    id: string,
    enabled: boolean,
    nextRunAt: Date | null,
  ): Promise<ApiTestScheduleRecord | null> {
    const result = await database.execute<{ id: string }>(sql`
      UPDATE api_test_schedules
      SET enabled = ${enabled},
          next_run_at = ${enabled ? nextRunAt : null},
          updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `);
    if (result.rows.length === 0) return null;
    return this.findSchedule(database, id);
  }

  public async deleteSchedule(database: Database, id: string): Promise<boolean> {
    const result = await database.execute<{ id: string }>(sql`
      DELETE FROM api_test_schedules WHERE id = ${id} RETURNING id
    `);
    return result.rows.length > 0;
  }

  /** 目标被删除时连带清掉指向它的定时任务，返回被删的 id 供调用方摘 Redis 调度。 */
  public async deleteSchedulesByTarget(
    database: Database,
    targetType: ApiTestScheduleTargetType,
    targetId: string,
  ): Promise<string[]> {
    const result = await database.execute<{ id: string }>(sql`
      DELETE FROM api_test_schedules
      WHERE target_type = ${targetType} AND target_id = ${targetId}
      RETURNING id
    `);
    return result.rows.map((row) => row.id);
  }

  /** 每触发一次回写批次和下次时间，列表页不用再读 Redis。 */
  public async recordScheduleRun(
    database: Database,
    id: string,
    input: { batchId: string; runAt: Date; nextRunAt: Date | null },
  ): Promise<void> {
    await database.execute(sql`
      UPDATE api_test_schedules
      SET last_batch_id = ${input.batchId},
          last_run_at = ${input.runAt},
          next_run_at = ${input.nextRunAt},
          last_error = NULL,
          updated_at = now()
      WHERE id = ${id}
    `);
  }

  /** 目标消失或环境失效时记下原因；永久性错误顺手停用，避免每次触发都失败。 */
  public async setScheduleFailure(
    database: Database,
    id: string,
    input: { message: string; disable: boolean },
  ): Promise<void> {
    await database.execute(sql`
      UPDATE api_test_schedules
      SET last_error = ${input.message},
          enabled = CASE WHEN ${input.disable} THEN false ELSE enabled END,
          next_run_at = CASE WHEN ${input.disable} THEN NULL ELSE next_run_at END,
          updated_at = now()
      WHERE id = ${id}
    `);
  }

  /** 仓库里已经删掉的目录对应的套件停用，历史执行记录不受影响。 */
  public async disableSuitesMissing(
    database: Database,
    commit: string,
    keepPaths: readonly string[],
  ): Promise<number> {
    const paths = sql.param([...keepPaths]);
    const result = await database.execute<{ id: string }>(sql`
      UPDATE api_test_suites
      SET enabled = false
      WHERE discovered = true
        AND enabled = true
        AND last_seen_commit IS DISTINCT FROM ${commit}
        AND path <> ALL(${paths}::text[])
      RETURNING id
    `);
    return result.rows.length;
  }
}
