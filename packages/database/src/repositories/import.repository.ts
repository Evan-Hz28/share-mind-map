import { sql } from "drizzle-orm";

import type { Database } from "../client.js";
import type { DatabaseTransaction } from "./member.repository.js";
import {
  ImportRepositoryError,
  type ImportBatchStatus,
  type ImportJobPhase,
  type CompatibilityStatus,
} from "./phase3.types.js";

/**
 * 批量导入的三道上限。按「一个文件夹拖进来」的用法放宽过一次:
 * 单批 50 → 100,单用户活跃 10 → 150,单工作区活跃 50 → 300。
 *
 * 判定写的是「当前活跃数 + 本次文件数 > 上限」,所以后两个必须显著大于单批上限,
 * 否则用户只要有一个别的任务在跑,一个满批就再也进不去了。
 */
const MAX_BATCH_JOBS = 100;
const MAX_ACTIVE_JOBS_PER_USER = 150;
const MAX_ACTIVE_JOBS_PER_WORKSPACE = 300;

export interface ImportBatchRecord {
  id: string;
  workspaceId: string;
  requestedBy: string;
  status: ImportBatchStatus;
  totalJobs: number;
  uploadedJobs: number;
  succeededJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  expectedBytes: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface ImportJobRecord {
  id: string;
  batchId: string;
  workspaceId: string;
  requestedBy: string;
  targetFolderId: string | null;
  documentId: string | null;
  clientFileName: string;
  targetName: string;
  targetNameNormalized: string;
  phase: ImportJobPhase;
  compressedBytes: number | null;
  actualBytes: number | null;
  sha256: string | null;
  tempObjectKey: string | null;
  originalObjectKey: string | null;
  compatibilityStatus: CompatibilityStatus;
  compatibilityReport: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  cancelRequested: boolean;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface DateRow {
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  started_at?: Date | string | null;
}

interface BatchRow extends DateRow {
  id: string;
  workspace_id: string;
  requested_by: string;
  status: ImportBatchStatus;
  total_jobs: number;
  uploaded_jobs: number;
  succeeded_jobs: number;
  failed_jobs: number;
  cancelled_jobs: number;
  expected_bytes: number | string;
}

interface JobRow extends DateRow, Record<string, unknown> {
  id: string;
  batch_id: string;
  workspace_id: string;
  requested_by: string;
  target_folder_id: string | null;
  document_id: string | null;
  client_file_name: string;
  target_name: string;
  target_name_normalized: string;
  phase: ImportJobPhase;
  compressed_bytes: number | string | null;
  actual_bytes: number | string | null;
  sha256: string | null;
  temp_object_key: string | null;
  original_object_key: string | null;
  compatibility_status: CompatibilityStatus;
  compatibility_report: unknown;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number | string;
  cancel_requested: boolean;
}

function asDate(value: Date | string | null): Date | null {
  return value === null ? null : value instanceof Date ? value : new Date(value);
}

function toBatch(row: BatchRow): ImportBatchRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    requestedBy: row.requested_by,
    status: row.status,
    totalJobs: row.total_jobs,
    uploadedJobs: row.uploaded_jobs,
    succeededJobs: row.succeeded_jobs,
    failedJobs: row.failed_jobs,
    cancelledJobs: row.cancelled_jobs,
    expectedBytes: Number(row.expected_bytes),
    createdAt: asDate(row.created_at) as Date,
    updatedAt: asDate(row.updated_at) as Date,
    completedAt: asDate(row.completed_at),
  };
}

function toJob(row: JobRow): ImportJobRecord {
  return {
    id: row.id,
    batchId: row.batch_id,
    workspaceId: row.workspace_id,
    requestedBy: row.requested_by,
    targetFolderId: row.target_folder_id,
    documentId: row.document_id,
    clientFileName: row.client_file_name,
    targetName: row.target_name,
    targetNameNormalized: row.target_name_normalized,
    phase: row.phase,
    compressedBytes: row.compressed_bytes === null ? null : Number(row.compressed_bytes),
    actualBytes: row.actual_bytes === null ? null : Number(row.actual_bytes),
    sha256: row.sha256,
    tempObjectKey: row.temp_object_key,
    originalObjectKey: row.original_object_key,
    compatibilityStatus: row.compatibility_status,
    compatibilityReport: row.compatibility_report,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    attemptCount: Number(row.attempt_count),
    cancelRequested: row.cancel_requested,
    createdAt: asDate(row.created_at) as Date,
    updatedAt: asDate(row.updated_at) as Date,
    startedAt: asDate(row.started_at ?? null),
    completedAt: asDate(row.completed_at),
  };
}

const jobColumns = `
  id, batch_id, workspace_id, requested_by, target_folder_id, document_id,
  client_file_name, target_name, target_name_normalized, phase, compressed_bytes,
  actual_bytes, sha256, temp_object_key, original_object_key, compatibility_status,
  compatibility_report, error_code, error_message, attempt_count, cancel_requested,
  created_at, updated_at, started_at, completed_at
`;

const batchColumns = `
  id, workspace_id, requested_by, status, total_jobs, uploaded_jobs,
  succeeded_jobs, failed_jobs, cancelled_jobs, expected_bytes, created_at,
  updated_at, completed_at
`;
const jobColumnsSql = sql.raw(jobColumns);

const transitionMap: Record<ImportJobPhase, readonly ImportJobPhase[]> = {
  waiting: ["uploading", "cancelled"],
  uploading: ["uploading", "parsing", "failed"],
  parsing: ["persisting", "failed"],
  persisting: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export class ImportRepository {
  public async createBatch(
    transaction: DatabaseTransaction,
    input: {
      batchId: string;
      workspaceId: string;
      requestedBy: string;
      jobs: Array<{
        id: string;
        targetFolderId?: string | null;
        clientFileName: string;
        targetName: string;
        targetNameNormalized: string;
        expectedBytes: number;
      }>;
    },
  ): Promise<void> {
    if (input.jobs.length === 0 || input.jobs.length > MAX_BATCH_JOBS) {
      throw new ImportRepositoryError(
        "IMPORT_QUEUE_LIMIT_REACHED",
        `A batch must contain 1 to ${String(MAX_BATCH_JOBS)} files.`,
      );
    }
    const workspace = await transaction.execute<{ id: string }>(sql`
      SELECT id FROM workspaces WHERE id = ${input.workspaceId} FOR UPDATE
    `);
    if (workspace.rows[0] === undefined) {
      throw new ImportRepositoryError("WORKSPACE_NOT_FOUND", "Workspace does not exist.");
    }
    const waitingByUser = await transaction.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM import_jobs
      WHERE requested_by = ${input.requestedBy}
        AND phase IN ('waiting', 'uploading', 'parsing', 'persisting')
    `);
    const waitingByWorkspace = await transaction.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM import_jobs
      WHERE workspace_id = ${input.workspaceId}
        AND phase IN ('waiting', 'uploading', 'parsing', 'persisting')
    `);
    if (
      (waitingByUser.rows[0]?.count ?? 0) + input.jobs.length > MAX_ACTIVE_JOBS_PER_USER ||
      (waitingByWorkspace.rows[0]?.count ?? 0) + input.jobs.length > MAX_ACTIVE_JOBS_PER_WORKSPACE
    ) {
      throw new ImportRepositoryError("IMPORT_QUEUE_LIMIT_REACHED", "Import queue limit reached.");
    }
    const expectedBytes = input.jobs.reduce((sum, job) => sum + job.expectedBytes, 0);
    const quota = await transaction.execute<{
      known_bytes: number | string;
      quota_bytes: number | string;
    }>(sql`
      SELECT
        (SELECT COALESCE(sum(CASE WHEN ds.snapshot_json IS NULL THEN 0 ELSE pg_column_size(ds.snapshot_json) END), 0)::bigint
         FROM document_snapshots ds JOIN documents d ON d.current_snapshot_id = ds.id
         WHERE d.workspace_id = ${input.workspaceId} AND d.trashed_at IS NULL) AS known_bytes,
        o.storage_quota_bytes AS quota_bytes
      FROM workspaces w JOIN organizations o ON o.id = w.organization_id
      WHERE w.id = ${input.workspaceId}
    `);
    const quotaRow = quota.rows[0];
    const reserved = await transaction.execute<{ bytes: number | string }>(sql`
      SELECT COALESCE(sum(expected_bytes), 0)::bigint AS bytes FROM import_batches
      WHERE workspace_id = ${input.workspaceId} AND status IN ('pending', 'uploading', 'processing')
    `);
    if (
      quotaRow !== undefined &&
      Number(quotaRow.known_bytes) + Number(reserved.rows[0]?.bytes ?? 0) + expectedBytes >
        Number(quotaRow.quota_bytes)
    ) {
      throw new ImportRepositoryError(
        "IMPORT_STORAGE_QUOTA_EXCEEDED",
        "Import storage quota exceeded.",
      );
    }
    // 下面是三个集合查询,不是每个 job 一组:整段跑在 workspaces 的 FOR UPDATE 锁里,
    // 100 个 job 逐个查会把锁持有多出两三百次往返。
    //
    // 数组参数必须包一层 sql.param:sql 模板遇到 JS 数组会展开成元组 ($1, $2),
    // 直接写 ANY(${ids}::uuid[]) 会被 Postgres 当成「record 转 uuid[]」报 42846。
    // sql.param 把整个数组当成**一个**参数交给驱动,node-postgres 会序列化成数组字面量。
    const folderIds = [
      ...new Set(
        input.jobs
          .map((job) => job.targetFolderId)
          .filter((folderId): folderId is string => typeof folderId === "string"),
      ),
    ];
    if (folderIds.length > 0) {
      const owned = await transaction.execute<{ id: string }>(sql`
        SELECT id FROM folders
        WHERE id = ANY(${sql.param(folderIds)}::uuid[]) AND workspace_id = ${input.workspaceId} AND trashed_at IS NULL
      `);
      const ownedIds = new Set(owned.rows.map((row) => row.id));
      if (folderIds.some((folderId) => !ownedIds.has(folderId))) {
        throw new ImportRepositoryError(
          "IMPORT_TARGET_FOLDER_INVALID",
          "Target folder is not in workspace.",
        );
      }
      const counts = await transaction.execute<{ folder_id: string; count: number }>(sql`
        SELECT d.folder_id, count(*)::int AS count FROM documents d
        JOIN folders f ON f.id = d.folder_id
        WHERE d.folder_id = ANY(${sql.param(folderIds)}::uuid[])
          AND f.workspace_id = ${input.workspaceId} AND d.trashed_at IS NULL
        GROUP BY d.folder_id
      `);
      const used = new Map(counts.rows.map((row) => [row.folder_id, row.count]));
      if (folderIds.some((folderId) => (used.get(folderId) ?? 0) >= 1000)) {
        throw new ImportRepositoryError(
          "IMPORT_TARGET_FOLDER_FULL",
          "Target folder document limit reached.",
        );
      }
    }
    const targetNames = [...new Set(input.jobs.map((job) => job.targetNameNormalized))];
    const conflict = await transaction.execute<{ name: string; normalized: string }>(sql`
      SELECT name_normalized AS normalized, name FROM documents
      WHERE workspace_id = ${input.workspaceId} AND name_normalized = ANY(${sql.param(targetNames)}::text[])
        AND trashed_at IS NULL
      UNION
      SELECT target_name_normalized AS normalized, target_name AS name FROM import_jobs
      WHERE workspace_id = ${input.workspaceId}
        AND target_name_normalized = ANY(${sql.param(targetNames)}::text[])
        AND phase IN ('waiting', 'uploading', 'parsing', 'persisting')
    `);
    if (conflict.rows[0] !== undefined) {
      const names = [
        ...new Map(conflict.rows.map((row) => [row.normalized, row.name])).values(),
      ];
      throw new ImportRepositoryError(
        "IMPORT_NAME_CONFLICT",
        "Target document name already exists.",
        names,
      );
    }
    await transaction.execute(sql`
      INSERT INTO import_batches (id, workspace_id, requested_by, total_jobs, expected_bytes, status)
      VALUES (${input.batchId}, ${input.workspaceId}, ${input.requestedBy}, ${input.jobs.length}, ${expectedBytes}, 'pending')
    `);
    for (const job of input.jobs) {
      await transaction.execute(sql`
        INSERT INTO import_jobs
          (id, batch_id, workspace_id, requested_by, target_folder_id, client_file_name,
           target_name, target_name_normalized, phase)
        VALUES
          (${job.id}, ${input.batchId}, ${input.workspaceId}, ${input.requestedBy},
           ${job.targetFolderId ?? null}, ${job.clientFileName}, ${job.targetName},
           ${job.targetNameNormalized}, 'waiting')
      `);
    }
  }

  public async findBatch(database: Database, batchId: string): Promise<ImportBatchRecord | null> {
    const result = await database.$client.query<BatchRow>(
      `SELECT ${batchColumns} FROM import_batches WHERE id = $1`,
      [batchId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toBatch(row);
  }

  /**
   * 整批任务一次查完。读接口是被前端每 500ms 轮询的,100 个任务逐个 findJob
   * 会变成 101 次查询,必须走这条。
   */
  public async listJobsByBatch(database: Database, batchId: string): Promise<ImportJobRecord[]> {
    const result = await database.$client.query<JobRow>(
      `SELECT ${jobColumns} FROM import_jobs WHERE batch_id = $1 ORDER BY created_at ASC, id ASC`,
      [batchId],
    );
    return result.rows.map((row) => toJob(row));
  }

  public async findJob(database: Database, jobId: string): Promise<ImportJobRecord | null> {
    const result = await database.$client.query<JobRow>(
      `SELECT ${jobColumns} FROM import_jobs WHERE id = $1`,
      [jobId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toJob(row);
  }

  public async transition(
    transaction: DatabaseTransaction,
    input: {
      jobId: string;
      from: ImportJobPhase;
      to: ImportJobPhase;
      patch?: {
        tempObjectKey?: string | null;
        originalObjectKey?: string | null;
        compressedBytes?: number | null;
        actualBytes?: number | null;
        sha256?: string | null;
        compatibilityStatus?: CompatibilityStatus;
        compatibilityReport?: unknown;
        errorCode?: string | null;
        errorMessage?: string | null;
        documentId?: string | null;
      };
    },
  ): Promise<ImportJobRecord> {
    if (!transitionMap[input.from].includes(input.to)) {
      throw new ImportRepositoryError(
        "INVALID_IMPORT_TRANSITION",
        `Cannot move ${input.from} to ${input.to}.`,
      );
    }
    const current = await transaction.execute<JobRow>(sql`
      SELECT ${jobColumnsSql} FROM import_jobs WHERE id = ${input.jobId} FOR UPDATE
    `);
    const row = current.rows[0];
    if (row === undefined) {
      throw new ImportRepositoryError("IMPORT_JOB_NOT_FOUND", "Import job does not exist.");
    }
    if (row.phase !== input.from) {
      throw new ImportRepositoryError(
        "INVALID_IMPORT_TRANSITION",
        `Expected ${input.from}, got ${row.phase}.`,
      );
    }
    const patch = input.patch ?? {};
    const compatibilityReport =
      patch.compatibilityReport === undefined ? null : JSON.stringify(patch.compatibilityReport);
    const values = [
      sql`phase = ${input.to}`,
      sql`temp_object_key = COALESCE(${patch.tempObjectKey ?? null}, temp_object_key)`,
      sql`original_object_key = COALESCE(${patch.originalObjectKey ?? null}, original_object_key)`,
      sql`compressed_bytes = COALESCE(${patch.compressedBytes ?? null}, compressed_bytes)`,
      sql`actual_bytes = COALESCE(${patch.actualBytes ?? null}, actual_bytes)`,
      sql`sha256 = COALESCE(${patch.sha256 ?? null}, sha256)`,
      sql`compatibility_status = COALESCE(${patch.compatibilityStatus ?? null}, compatibility_status)`,
      sql`compatibility_report = COALESCE(${compatibilityReport}::jsonb, compatibility_report)`,
      sql`error_code = ${patch.errorCode ?? (input.to === "failed" ? "IMPORT_FAILED" : null)}`,
      sql`error_message = ${patch.errorMessage ?? null}`,
      sql`document_id = COALESCE(${patch.documentId ?? null}, document_id)`,
      sql`started_at = CASE WHEN ${input.to} IN ('uploading', 'parsing', 'persisting') AND started_at IS NULL THEN now() ELSE started_at END`,
      sql`completed_at = CASE WHEN ${input.to} IN ('succeeded', 'failed', 'cancelled') THEN now() ELSE NULL END`,
      sql`updated_at = now()`,
    ];
    const updated = await transaction.execute<JobRow>(sql`
      UPDATE import_jobs SET ${sql.join(values, sql`, `)}
      WHERE id = ${input.jobId}
      RETURNING ${jobColumnsSql}
    `);
    await this.refreshBatch(transaction, row.batch_id);
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) throw new Error("Import transition returned no row.");
    return toJob(updatedRow);
  }

  public async recordUpload(
    transaction: DatabaseTransaction,
    input: {
      jobId: string;
      tempObjectKey: string;
      compressedBytes: number;
      actualBytes: number;
      sha256: string;
    },
  ): Promise<ImportJobRecord> {
    const current = await transaction.execute<JobRow>(sql`
      SELECT ${jobColumnsSql} FROM import_jobs WHERE id = ${input.jobId} FOR UPDATE
    `);
    const row = current.rows[0];
    if (row === undefined)
      throw new ImportRepositoryError("IMPORT_JOB_NOT_FOUND", "Import job does not exist.");
    if (row.phase !== "uploading")
      throw new ImportRepositoryError(
        "INVALID_IMPORT_TRANSITION",
        "Job is not accepting an upload.",
      );
    await transaction.execute(
      sql`SELECT id FROM workspaces WHERE id = ${row.workspace_id} FOR UPDATE`,
    );
    const quota = await transaction.execute<{
      known_bytes: number | string;
      quota_bytes: number | string;
    }>(sql`
      SELECT
        (SELECT COALESCE(sum(CASE WHEN ds.snapshot_json IS NULL THEN 0 ELSE pg_column_size(ds.snapshot_json) END), 0)::bigint
         FROM document_snapshots ds JOIN documents d ON d.current_snapshot_id = ds.id
         WHERE d.workspace_id = ${row.workspace_id} AND d.trashed_at IS NULL) AS known_bytes,
        o.storage_quota_bytes AS quota_bytes
      FROM workspaces w JOIN organizations o ON o.id = w.organization_id WHERE w.id = ${row.workspace_id}
    `);
    const reserved = await transaction.execute<{ bytes: number | string }>(sql`
      SELECT COALESCE(sum(expected_bytes), 0)::bigint AS bytes FROM import_batches
      WHERE workspace_id = ${row.workspace_id} AND status IN ('pending', 'uploading', 'processing') AND id <> ${row.batch_id}
    `);
    const batchUploaded = await transaction.execute<{ bytes: number | string }>(sql`
      SELECT COALESCE(sum(actual_bytes), 0)::bigint AS bytes FROM import_jobs
      WHERE batch_id = ${row.batch_id} AND id <> ${row.id} AND actual_bytes IS NOT NULL
    `);
    const quotaRow = quota.rows[0];
    if (
      quotaRow !== undefined &&
      Number(quotaRow.known_bytes) +
        Number(reserved.rows[0]?.bytes ?? 0) +
        Number(batchUploaded.rows[0]?.bytes ?? 0) +
        input.actualBytes >
        Number(quotaRow.quota_bytes)
    ) {
      throw new ImportRepositoryError(
        "IMPORT_STORAGE_QUOTA_EXCEEDED",
        "Import storage quota exceeded.",
      );
    }
    const updated = await transaction.execute<JobRow>(sql`
      UPDATE import_jobs
      SET temp_object_key = ${input.tempObjectKey}, compressed_bytes = ${input.compressedBytes},
          actual_bytes = ${input.actualBytes}, sha256 = ${input.sha256}, updated_at = now()
      WHERE id = ${input.jobId}
      RETURNING ${jobColumnsSql}
    `);
    await this.refreshBatch(transaction, row.batch_id);
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) throw new Error("Upload update returned no row.");
    return toJob(updatedRow);
  }

  public async retryFailed(transaction: DatabaseTransaction, jobId: string): Promise<void> {
    const result = await transaction.execute<{ batch_id: string }>(sql`
      UPDATE import_jobs
      SET phase = 'waiting', attempt_count = attempt_count + 1,
          error_code = NULL, error_message = NULL, cancel_requested = false,
          document_id = NULL, temp_object_key = NULL, original_object_key = NULL,
          compressed_bytes = NULL, actual_bytes = NULL, sha256 = NULL,
          started_at = NULL, completed_at = NULL, updated_at = now()
      WHERE id = ${jobId} AND phase = 'failed'
      RETURNING batch_id
    `);
    const row = result.rows[0];
    if (row === undefined) {
      throw new ImportRepositoryError(
        "IMPORT_RETRY_NOT_ALLOWED",
        "Only failed jobs can be retried.",
      );
    }
    await this.refreshBatch(transaction, row.batch_id);
  }

  private async refreshBatch(transaction: DatabaseTransaction, batchId: string): Promise<void> {
    await transaction.execute(sql`
      WITH counts AS (
        SELECT
          count(*) FILTER (WHERE phase IN ('uploading', 'parsing', 'persisting', 'succeeded', 'failed'))::int AS uploaded,
          count(*) FILTER (WHERE phase = 'succeeded')::int AS succeeded,
          count(*) FILTER (WHERE phase = 'failed')::int AS failed,
          count(*) FILTER (WHERE phase = 'cancelled')::int AS cancelled,
          count(*) FILTER (WHERE phase IN ('waiting', 'uploading', 'parsing', 'persisting'))::int AS active,
          count(*) FILTER (WHERE phase IN ('parsing', 'persisting'))::int AS processing,
          count(*) FILTER (WHERE phase IN ('succeeded', 'failed', 'cancelled'))::int AS terminal,
          count(*)::int AS total
        FROM import_jobs WHERE batch_id = ${batchId}
      )
      UPDATE import_batches AS b
      SET uploaded_jobs = counts.uploaded,
          succeeded_jobs = counts.succeeded,
          failed_jobs = counts.failed,
          cancelled_jobs = counts.cancelled,
          status = CASE
            WHEN counts.terminal < counts.total AND counts.processing > 0 THEN 'processing'
            WHEN counts.terminal < counts.total AND counts.uploaded > 0 THEN 'uploading'
            WHEN counts.terminal < counts.total THEN 'pending'
            WHEN counts.failed > 0 AND counts.succeeded > 0 THEN 'partial'
            WHEN counts.failed > 0 THEN 'failed'
            WHEN counts.cancelled = counts.total THEN 'cancelled'
            ELSE 'succeeded'
          END,
          completed_at = CASE WHEN counts.terminal = counts.total THEN COALESCE(b.completed_at, now()) ELSE NULL END,
          updated_at = now()
      FROM counts
      WHERE b.id = ${batchId}
    `);
  }
}
