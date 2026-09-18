import type { Database } from "../client.js";
import type { WorkspaceUsage } from "./phase2.types.js";

function thresholdFor(usagePercent: number): WorkspaceUsage["threshold"] {
  if (usagePercent >= 100) return "exceeded";
  if (usagePercent >= 95) return "critical";
  if (usagePercent >= 80) return "warning";
  return "normal";
}

export class QuotaRepository {
  public constructor(private readonly database: Database) {}

  public async readWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsage | null> {
    const result = await this.database.$client.query<{
      folder_count: number;
      document_count: number;
      known_object_bytes: string;
      quota_bytes: string;
    }>(
      `SELECT
         (SELECT count(*)::int FROM folders f WHERE f.workspace_id = w.id AND f.trashed_at IS NULL) AS folder_count,
         (SELECT count(*)::int FROM documents d WHERE d.workspace_id = w.id AND d.trashed_at IS NULL) AS document_count,
         (SELECT COALESCE(sum(CASE WHEN ds.snapshot_json IS NULL THEN 0 ELSE pg_column_size(ds.snapshot_json) END), 0)::bigint
          FROM document_snapshots ds
          JOIN documents d ON d.current_snapshot_id = ds.id
          WHERE d.workspace_id = w.id AND d.trashed_at IS NULL) AS known_object_bytes,
         o.storage_quota_bytes AS quota_bytes
       FROM workspaces w
       JOIN organizations o ON o.id = w.organization_id
       WHERE w.id = $1`,
      [workspaceId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const quotaBytes = Number(row.quota_bytes);
    const knownObjectBytes = Number(row.known_object_bytes);
    const usagePercent = quotaBytes === 0 ? 100 : (knownObjectBytes / quotaBytes) * 100;
    return {
      workspaceId,
      folderCount: row.folder_count,
      documentCount: row.document_count,
      knownObjectBytes,
      quotaBytes,
      usagePercent,
      threshold: thresholdFor(usagePercent),
      reconciliationStatus: "pending",
    };
  }
}
