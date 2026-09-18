import { Inject, Injectable } from "@nestjs/common";

import type { Database } from "@share-mind-map/database";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import type { AuthContext } from "../auth/auth-context.js";
import { ApiError } from "../platform/errors/api-error.js";
import type {
  AdminImportFailureListDto,
  AdminImportFailureQueryDto,
} from "./dto/import-failure.dto.js";

@Injectable()
export class ImportFailuresService {
  public constructor(@Inject(AUTH_DATABASE) private readonly database: Database) {}

  public async list(
    auth: AuthContext,
    query: AdminImportFailureQueryDto,
  ): Promise<AdminImportFailureListDto> {
    if (auth.session.role !== "admin") throw new ApiError("PERMISSION_DENIED");
    const values: unknown[] = [auth.session.workspaceId, Math.min(query.limit, 100) + 1];
    const cursor = query.after === undefined ? "" : "AND j.id > $3::uuid";
    if (query.after !== undefined) values.push(query.after);
    const result = await this.database.$client.query<{
      id: string;
      batch_id: string;
      client_file_name: string;
      target_name: string;
      error_code: string | null;
      error_message: string | null;
      completed_at: Date | string | null;
    }>(
      `SELECT j.id, j.batch_id, j.client_file_name, j.target_name, j.error_code, j.error_message, j.completed_at
       FROM import_jobs j
       WHERE j.workspace_id = $1 AND j.phase = 'failed' ${cursor}
       ORDER BY j.id ASC LIMIT $2`,
      values,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    return {
      failures: rows.map((row) => ({
        id: row.id,
        batchId: row.batch_id,
        clientFileName: row.client_file_name,
        targetName: row.target_name,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        completedAt: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
      })),
      nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
    };
  }
}
