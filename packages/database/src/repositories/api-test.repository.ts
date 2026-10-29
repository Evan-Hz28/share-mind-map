import { sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { newId } from "../id.js";

export type ApiTestRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ApiTestItemStatus = "passed" | "failed" | "skipped" | "error";

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

const runColumns = sql.raw(`
  r.id, r.suite_id, s.key AS suite_key, s.name AS suite_name, s.path AS suite_path,
  r.environment_id, e.key AS environment_key, e.name AS environment_name,
  e.base_url AS environment_base_url,
  r.requested_by, r.mode, r.status, r.cancel_requested,
  r.total_count, r.passed_count, r.failed_count, r.skipped_count,
  r.error_message, r.created_at, r.started_at, r.finished_at
`);

const itemColumns = sql.raw(`
  id, run_id, node_id, case_name, ordinal, status, duration_ms, failure,
  request, response, created_at
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
    },
  ): Promise<ApiTestRunRecord> {
    await database.execute(sql`
      INSERT INTO api_test_runs (id, suite_id, environment_id, requested_by, mode, selection, status)
      VALUES (
        ${input.id}, ${input.suiteId}, ${input.environmentId}, ${input.requestedBy},
        ${input.mode}, ${JSON.stringify(input.selection)}::jsonb, 'queued'
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

  public async listRuns(database: Database, limit: number): Promise<ApiTestRunRecord[]> {
    const result = await database.execute<RunRow>(sql`
      SELECT ${runColumns}
      FROM api_test_runs r
      JOIN api_test_suites s ON s.id = r.suite_id
      JOIN api_test_environments e ON e.id = r.environment_id
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${Math.min(Math.max(limit, 1), 100)}
    `);
    return result.rows.map(toRun);
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
}
