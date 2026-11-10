import { sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { newId } from "../id.js";

export type ApiTestRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ApiTestItemStatus = "passed" | "failed" | "skipped" | "error";
export type ApiTestSyncStatus = "queued" | "running" | "succeeded" | "failed";
export type ApiTestSyncTrigger = "manual" | "webhook" | "schedule";

/**
 * 同步正常是秒级，最慢的 git 命令也有 5 分钟超时；超过这个时长还没结束，
 * 基本就是 worker 重启、队列丢失这类中断，按失败处理，避免永久挡住下一次同步。
 */
export const API_TEST_SYNC_STALE_SECONDS = 30 * 60;

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
  casesAdded: number;
  casesRemoved: number;
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
  /** 已编目的函数数，不含文件行。 */
  caseCount: number;
  fileCount: number;
  createdAt: Date;
}

export type ApiTestTargetKind = "file" | "case";

/** 用例编目：node_id 是仓库相对路径，文件为 `a/b/test_x.py`，函数额外带 `::Class::func`。 */
export interface ApiTestCaseRecord {
  id: string;
  suiteId: string;
  nodeId: string;
  filePath: string;
  name: string;
  kind: ApiTestTargetKind;
  ordinal: number;
  enabled: boolean;
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
  /** 执行范围：`{ path }` 表示整个测试集，额外带 `nodeIds` 时只跑所选用例。 */
  selection: unknown;
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

/**
 * 集合成员：caseId 为空表示整个测试集，否则是一条具体的文件/函数。
 * 展示和执行都按 position 保持用户保存的顺序。
 */
export interface ApiTestCollectionItemRecord {
  id: string;
  position: number;
  suiteId: string;
  suiteKey: string;
  suiteName: string;
  suitePath: string;
  suiteEnabled: boolean;
  caseId: string | null;
  caseNodeId: string | null;
  caseName: string | null;
  caseKind: ApiTestTargetKind | null;
  caseEnabled: boolean | null;
  lastRunId: string | null;
  lastRunStatus: ApiTestRunStatus | null;
  totalCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  lastRunAt: Date | null;
}

/** 执行目标：nodeIds 为空表示整个测试集，非空表示只跑这些用例。 */
export interface ApiTestRunTarget {
  suiteId: string;
  path: string;
  nodeIds: string[];
}

/**
 * 把有序的集合成员整理成按测试集分组的执行目标。
 * 同一测试集既被整体选中、又被单独选了用例时，整体优先；失效成员直接跳过。
 */
/** `file.py::Class::test` 是否已经被同一个文件行覆盖。 */
function coveredByFile(nodeId: string, files: Set<string> | undefined): boolean {
  if (files === undefined) return false;
  const separator = nodeId.indexOf("::");
  return separator !== -1 && files.has(nodeId.slice(0, separator));
}

export function groupCollectionTargets(
  items: ApiTestCollectionItemRecord[],
): ApiTestRunTarget[] {
  const groups = new Map<string, ApiTestRunTarget>();
  const wholeSuites = new Set(
    items.filter((item) => item.suiteEnabled && item.caseId === null).map((item) => item.suiteId),
  );
  // 选了整个文件就不必再单独跑它下面的函数，否则同一个用例会执行两次。
  const fileNodes = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item.suiteEnabled || item.caseId === null || item.caseEnabled !== true) continue;
    if (item.caseKind !== "file" || item.caseNodeId === null) continue;
    const files = fileNodes.get(item.suiteId) ?? new Set<string>();
    files.add(item.caseNodeId);
    fileNodes.set(item.suiteId, files);
  }
  for (const item of items) {
    if (!item.suiteEnabled) continue;
    if (item.caseId === null) {
      groups.set(item.suiteId, { suiteId: item.suiteId, path: item.suitePath, nodeIds: [] });
      continue;
    }
    if (item.caseEnabled !== true || item.caseNodeId === null) continue;
    if (wholeSuites.has(item.suiteId)) continue;
    if (item.caseKind === "case" && coveredByFile(item.caseNodeId, fileNodes.get(item.suiteId))) {
      continue;
    }
    const existing = groups.get(item.suiteId);
    if (existing === undefined) {
      groups.set(item.suiteId, {
        suiteId: item.suiteId,
        path: item.suitePath,
        nodeIds: [item.caseNodeId],
      });
    } else if (!existing.nodeIds.includes(item.caseNodeId)) {
      existing.nodeIds.push(item.caseNodeId);
    }
  }
  return [...groups.values()];
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
  case_count: number;
  file_count: number;
  created_at: Date | string;
}

interface CaseRow extends Record<string, unknown> {
  id: string;
  suite_id: string;
  node_id: string;
  file_path: string;
  name: string;
  kind: ApiTestTargetKind;
  ordinal: number;
  enabled: boolean;
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
  selection: unknown;
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

interface CollectionItemRow extends Record<string, unknown> {
  id: string;
  position: number;
  suite_id: string;
  suite_key: string;
  suite_name: string;
  suite_path: string;
  suite_enabled: boolean;
  case_id: string | null;
  case_node_id: string | null;
  case_name: string | null;
  case_kind: ApiTestTargetKind | null;
  case_enabled: boolean | null;
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
  cases_added: number;
  cases_removed: number;
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
    caseCount: row.case_count,
    fileCount: row.file_count,
    createdAt: asDate(row.created_at) as Date,
  };
}

function toCase(row: CaseRow): ApiTestCaseRecord {
  return {
    id: row.id,
    suiteId: row.suite_id,
    nodeId: row.node_id,
    filePath: row.file_path,
    name: row.name,
    kind: row.kind,
    ordinal: row.ordinal,
    enabled: row.enabled,
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
    selection: row.selection,
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

function toCollectionItem(row: CollectionItemRow): ApiTestCollectionItemRecord {
  return {
    id: row.id,
    position: row.position,
    suiteId: row.suite_id,
    suiteKey: row.suite_key,
    suiteName: row.suite_name,
    suitePath: row.suite_path,
    suiteEnabled: row.suite_enabled,
    caseId: row.case_id,
    caseNodeId: row.case_node_id,
    caseName: row.case_name,
    caseKind: row.case_kind,
    caseEnabled: row.case_enabled,
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
    casesAdded: row.cases_added,
    casesRemoved: row.cases_removed,
    requirementsChanged: row.requirements_changed,
    message: row.message,
    startedAt: asDate(row.started_at),
    finishedAt: asDate(row.finished_at),
    createdAt: asDate(row.created_at) as Date,
  };
}

const syncColumns = sql.raw(`
  id, branch, status, trigger, requested_by, commit_sha, previous_sha,
  changed_files, suites_added, suites_removed, cases_added, cases_removed,
  requirements_changed, message, started_at, finished_at, created_at
`);

const runColumns = sql.raw(`
  r.id, r.suite_id, s.key AS suite_key, s.name AS suite_name, s.path AS suite_path,
  r.environment_id, e.key AS environment_key, e.name AS environment_name,
  e.base_url AS environment_base_url,
  r.requested_by, r.mode, r.selection, r.batch_id, r.collection_id, r.repo_commit,
  r.status, r.cancel_requested,
  r.total_count, r.passed_count, r.failed_count, r.skipped_count,
  r.error_message, r.created_at, r.started_at, r.finished_at
`);

/** 列表和详情都要展示用例数，统一走这个 lateral，避免把编目表铺开。 */
const suiteCounts = sql.raw(`
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE c.kind = 'case')::int AS case_count,
           count(*) FILTER (WHERE c.kind = 'file')::int AS file_count
    FROM api_test_cases c
    WHERE c.suite_id = s.id AND c.enabled = true
  ) counts ON true
`);

const itemColumns = sql.raw(`
  id, run_id, node_id, case_name, ordinal, status, duration_ms, failure,
  request, response, created_at
`);

/** 目标名、环境名和上次结果都 join 出来，列表页一次查询就够。 */
const scheduleSelect = sql.raw(`
  SELECT s.id, s.name, s.target_type, s.target_id,
         COALESCE(su.name, c.name, tc.name) AS target_name,
         COALESCE(su.path, tc.node_id) AS target_path,
         s.environment_id, e.name AS environment_name, e.key AS environment_key,
         s.cron, s.timezone, s.sync_before_run, s.enabled,
         s.next_run_at, s.last_batch_id, s.last_run_at, s.last_error,
         s.created_by, s.created_at, s.updated_at,
         agg.last_status, agg.last_total_count, agg.last_passed_count,
         agg.last_failed_count, agg.last_skipped_count
  FROM api_test_schedules s
  LEFT JOIN api_test_suites su ON s.target_type = 'suite' AND su.id = s.target_id
  LEFT JOIN api_test_collections c ON s.target_type = 'collection' AND c.id = s.target_id
  LEFT JOIN api_test_cases tc ON s.target_type = 'case' AND tc.id = s.target_id
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
      SELECT s.id, s.key, s.name, s.path, s.enabled, s.created_at,
             COALESCE(counts.case_count, 0) AS case_count,
             COALESCE(counts.file_count, 0) AS file_count
      FROM api_test_suites s
      ${suiteCounts}
      WHERE s.enabled = true
      ORDER BY s.key
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
      SELECT s.id, s.key, s.name, s.path, s.enabled, s.created_at,
             COALESCE(counts.case_count, 0) AS case_count,
             COALESCE(counts.file_count, 0) AS file_count
      FROM api_test_suites s
      ${suiteCounts}
      WHERE s.id = ${id} AND s.enabled = true
    `);
    const row = result.rows[0];
    return row === undefined ? null : toSuite(row);
  }

  public async listCases(database: Database, suiteId: string): Promise<ApiTestCaseRecord[]> {
    const result = await database.execute<CaseRow>(sql`
      SELECT id, suite_id, node_id, file_path, name, kind, ordinal, enabled
      FROM api_test_cases
      WHERE suite_id = ${suiteId} AND enabled = true
      ORDER BY file_path, ordinal, id
    `);
    return result.rows.map(toCase);
  }

  public async findCase(database: Database, id: string): Promise<ApiTestCaseRecord | null> {
    const result = await database.execute<CaseRow>(sql`
      SELECT id, suite_id, node_id, file_path, name, kind, ordinal, enabled
      FROM api_test_cases
      WHERE id = ${id} AND enabled = true
    `);
    const row = result.rows[0];
    return row === undefined ? null : toCase(row);
  }

  /**
   * 同步扫描结果是全量的，用一条语句批量 upsert；逐条 INSERT 在 6000+ 用例时太慢。
   * 冲突时保留原 id，只刷新路径、名字和可见状态。
   */
  public async upsertCases(
    database: Database,
    cases: {
      id: string;
      suiteId: string;
      nodeId: string;
      filePath: string;
      name: string;
      kind: ApiTestTargetKind;
      ordinal: number;
      commit: string;
    }[],
  ): Promise<number> {
    if (cases.length === 0) return 0;
    const payload = JSON.stringify(
      cases.map((item) => ({
        id: item.id,
        suite_id: item.suiteId,
        node_id: item.nodeId,
        file_path: item.filePath,
        name: item.name,
        kind: item.kind,
        ordinal: item.ordinal,
        commit: item.commit,
      })),
    );
    const result = await database.execute<{ inserted: number }>(sql`
      WITH upserted AS (
        INSERT INTO api_test_cases (
          id, suite_id, node_id, file_path, name, kind, ordinal,
          enabled, discovered, last_seen_commit
        )
        SELECT row.id, row.suite_id, row.node_id, row.file_path, row.name,
               row.kind, row.ordinal, true, true, row.commit
        FROM jsonb_to_recordset(${payload}::jsonb) AS row(
          id uuid, suite_id uuid, node_id text, file_path text, name text,
          kind varchar, ordinal integer, commit varchar
        )
        ON CONFLICT (suite_id, node_id) DO UPDATE
          SET file_path = excluded.file_path,
              name = excluded.name,
              kind = excluded.kind,
              ordinal = excluded.ordinal,
              enabled = true,
              last_seen_commit = excluded.last_seen_commit
        RETURNING (xmax = 0) AS inserted
      )
      SELECT count(*) FILTER (WHERE inserted)::int AS inserted FROM upserted
    `);
    return result.rows[0]?.inserted ?? 0;
  }

  /** 只有整轮扫描成功后才调用：本轮没见到的用例停用，历史记录和集合引用保留。 */
  public async disableCasesMissing(database: Database, commit: string): Promise<number> {
    const result = await database.execute<{ id: string }>(sql`
      UPDATE api_test_cases
      SET enabled = false
      WHERE discovered = true
        AND enabled = true
        AND last_seen_commit IS DISTINCT FROM ${commit}
      RETURNING id
    `);
    return result.rows.length;
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
        SELECT count(DISTINCT item.suite_id)::int AS suite_count,
               COALESCE(SUM(CASE
                 WHEN item.case_id IS NULL THEN COALESCE(suite_cases.case_count, 0)
                 ELSE 1
               END), 0)::int AS case_count,
               MAX(latest.created_at) AS last_run_at,
               (ARRAY_AGG(latest.status ORDER BY latest.created_at DESC))[1] AS last_run_status
        FROM api_test_collection_items item
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS case_count
          FROM api_test_cases c
          WHERE c.suite_id = item.suite_id AND c.enabled = true AND c.kind = 'case'
        ) suite_cases ON true
        LEFT JOIN LATERAL (
          SELECT r.total_count, r.created_at, r.status
          FROM api_test_runs r
          WHERE r.suite_id = item.suite_id
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT 1
        ) latest ON true
        WHERE item.collection_id = c.id
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
        SELECT count(DISTINCT item.suite_id)::int AS suite_count,
               COALESCE(SUM(CASE
                 WHEN item.case_id IS NULL THEN COALESCE(suite_cases.case_count, 0)
                 ELSE 1
               END), 0)::int AS case_count,
               MAX(latest.created_at) AS last_run_at,
               (ARRAY_AGG(latest.status ORDER BY latest.created_at DESC))[1] AS last_run_status
        FROM api_test_collection_items item
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS case_count
          FROM api_test_cases tc
          WHERE tc.suite_id = item.suite_id AND tc.enabled = true AND tc.kind = 'case'
        ) suite_cases ON true
        LEFT JOIN LATERAL (
          SELECT r.total_count, r.created_at, r.status
          FROM api_test_runs r
          WHERE r.suite_id = item.suite_id
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT 1
        ) latest ON true
        WHERE item.collection_id = c.id
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
  public async replaceCollectionItems(
    database: Database,
    collectionId: string,
    items: { suiteId: string; caseId: string | null }[],
  ): Promise<void> {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`DELETE FROM api_test_collection_items WHERE collection_id = ${collectionId}`,
      );
      for (const [position, item] of items.entries()) {
        await transaction.execute(sql`
          INSERT INTO api_test_collection_items (id, collection_id, suite_id, case_id, position)
          VALUES (${newId()}, ${collectionId}, ${item.suiteId}, ${item.caseId}, ${position})
        `);
      }
      await transaction.execute(
        sql`UPDATE api_test_collections SET updated_at = now() WHERE id = ${collectionId}`,
      );
    });
  }

  public async listCollectionItems(
    database: Database,
    collectionId: string,
  ): Promise<ApiTestCollectionItemRecord[]> {
    const result = await database.execute<CollectionItemRow>(sql`
      SELECT item.id, item.position, item.suite_id,
             s.key AS suite_key, s.name AS suite_name, s.path AS suite_path,
             s.enabled AS suite_enabled,
             item.case_id, c.node_id AS case_node_id, c.name AS case_name,
             c.kind AS case_kind, c.enabled AS case_enabled,
             latest.id AS last_run_id, latest.status AS last_run_status,
             latest.total_count, latest.passed_count, latest.failed_count,
             latest.skipped_count, latest.created_at AS last_run_at
      FROM api_test_collection_items item
      JOIN api_test_suites s ON s.id = item.suite_id
      LEFT JOIN api_test_cases c ON c.id = item.case_id
      LEFT JOIN LATERAL (
        SELECT r.id, r.status, r.total_count, r.passed_count, r.failed_count,
               r.skipped_count, r.created_at
        FROM api_test_runs r
        WHERE r.suite_id = s.id
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1
      ) latest ON true
      WHERE item.collection_id = ${collectionId}
      ORDER BY item.position, item.id
    `);
    return result.rows.map(toCollectionItem);
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

  /** 单条用例结果：失败重跑要沿用它所属 run 的测试集、环境和精确 node id。 */
  public async findRunItem(
    database: Database,
    id: string,
  ): Promise<ApiTestRunItemRecord | null> {
    const result = await database.execute<ItemRow>(sql`
      SELECT ${itemColumns}
      FROM api_test_run_items
      WHERE id = ${id}
    `);
    const row = result.rows[0];
    return row === undefined ? null : toItem(row);
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

  /**
   * 标记开始执行。`running` 也接受：worker 重启后 BullMQ 会重投 stalled 的 job，
   * 只认 `queued` 会把重试静默丢掉，记录就永远停在运行中。
   */
  public async markSyncRunning(database: Database, id: string): Promise<boolean> {
    const result = await database.execute<{ id: string }>(sql`
      UPDATE api_test_syncs
      SET status = 'running', started_at = COALESCE(started_at, now())
      WHERE id = ${id} AND status IN ('queued', 'running')
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  /** 队列里已经没有对应 job 的记录会被标记失败，否则会一直挡住新同步。 */
  public async expireSync(database: Database, id: string, message: string): Promise<boolean> {
    const result = await database.execute<{ id: string }>(sql`
      UPDATE api_test_syncs
      SET status = 'failed', finished_at = now(), message = ${message}
      WHERE id = ${id} AND status IN ('queued', 'running')
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  /** 兜底清理：超过时限还没有进展的同步记录，多半是 worker 重启或队列丢失留下的。 */
  public async expireStaleSyncs(
    database: Database,
    staleSeconds: number,
    message: string,
  ): Promise<number> {
    const result = await database.execute<{ id: string }>(sql`
      UPDATE api_test_syncs
      SET status = 'failed', finished_at = now(), message = ${message}
      WHERE status IN ('queued', 'running')
        AND created_at < now() - make_interval(secs => ${staleSeconds})
      RETURNING id
    `);
    return result.rows.length;
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
      casesAdded: number;
      casesRemoved: number;
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
          cases_added = ${input.casesAdded},
          cases_removed = ${input.casesRemoved},
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
