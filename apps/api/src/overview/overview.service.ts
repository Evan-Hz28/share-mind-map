import type { Database } from "@share-mind-map/database";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { ApiError } from "../platform/errors/api-error.js";
import type { WorkspaceOverviewDto } from "./dto/overview.dto.js";

interface OverviewRow {
  folder_count: number;
  document_count: number;
  node_count: string;
  active_import_jobs: number;
  pending_edit_requests: number;
}

@Injectable()
export class OverviewService {
  public constructor(@Inject(AUTH_DATABASE) private readonly database: Database) {}

  public async read(auth: AuthContext, workspaceId: string): Promise<WorkspaceOverviewDto> {
    if (auth.session.workspaceId !== workspaceId) throw new ApiError("PERMISSION_DENIED");
    const result = await this.database.$client.query<OverviewRow>(
      `SELECT
         (SELECT count(*)::int FROM folders f
          WHERE f.workspace_id = $1 AND f.trashed_at IS NULL) AS folder_count,
         (SELECT count(*)::int FROM documents d
          WHERE d.workspace_id = $1 AND d.trashed_at IS NULL) AS document_count,
         (SELECT COALESCE(sum(d.node_count), 0)::bigint FROM documents d
          WHERE d.workspace_id = $1 AND d.trashed_at IS NULL) AS node_count,
         (SELECT count(*)::int FROM import_jobs j
          WHERE j.workspace_id = $1
            AND j.phase IN ('waiting', 'uploading', 'parsing', 'persisting')) AS active_import_jobs,
         (SELECT count(*)::int FROM edit_permission_requests r
          WHERE r.workspace_id = $1 AND r.status = 'pending' AND $2::boolean) AS pending_edit_requests`,
      [workspaceId, auth.session.role === "admin"],
    );
    const row = result.rows[0];
    if (row === undefined) throw new ApiError("NOT_FOUND");
    return {
      workspaceId,
      folderCount: row.folder_count,
      documentCount: row.document_count,
      nodeCount: Number(row.node_count),
      activeImportJobs: row.active_import_jobs,
      pendingEditRequests: row.pending_edit_requests,
    };
  }
}
