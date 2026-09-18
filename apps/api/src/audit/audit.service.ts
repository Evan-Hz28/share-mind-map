import { decodeCursor, encodeCursor, type Database } from "@share-mind-map/database";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { ApiError } from "../platform/errors/api-error.js";
import type { AuditListResponseDto, AuditLogDto, AuditQueryDto } from "./dto/audit.dto.js";

interface AuditRow extends Record<string, unknown> {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  result: "success" | "failure" | "denied";
  metadata: Record<string, unknown>;
  created_at: Date | string;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function safeMetadata(
  metadata: Record<string, unknown>,
): Record<string, boolean | number | string | null> {
  const result: Record<string, boolean | number | string | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/password|token|cookie|secret|credential|body|snapshot|objectKey/i.test(key)) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      typeof value === "number"
    )
      result[key] = value;
  }
  return result;
}

function toDto(row: AuditRow): AuditLogDto {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    result: row.result,
    metadata: safeMetadata(row.metadata),
    createdAt: asDate(row.created_at).toISOString(),
  };
}

@Injectable()
export class AuditService {
  public constructor(@Inject(AUTH_DATABASE) private readonly database: Database) {}

  public async list(auth: AuthContext, query: AuditQueryDto): Promise<AuditListResponseDto> {
    if (query.from !== undefined && query.to !== undefined && query.from > query.to)
      throw new ApiError("AUDIT_FILTER_INVALID");
    const values: unknown[] = [auth.session.workspaceId];
    const filters = ["workspace_id = $1"];
    const add = (value: unknown, clause: string) => {
      values.push(value);
      filters.push(clause.replace("$N", `$${String(values.length)}`));
    };
    if (query.from !== undefined) add(query.from, "created_at >= $N::timestamptz");
    if (query.to !== undefined) add(query.to, "created_at <= $N::timestamptz");
    if (query.action !== undefined) add(query.action, "action = $N");
    if (query.result !== undefined) add(query.result, "result = $N");
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      values.push(cursor.sortValue, cursor.id);
      filters.push(
        `(created_at, id) < ($${String(values.length - 1)}::timestamptz, $${String(values.length)}::uuid)`,
      );
    }
    const limit = Math.min(Math.max(query.limit, 1), 100);
    values.push(limit + 1);
    const rows = await this.database.$client.query<AuditRow>(
      `SELECT id, actor_user_id, action, target_type, target_id, result, metadata, created_at
       FROM audit_logs WHERE ${filters.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT $${String(values.length)}`,
      values,
    );
    const hasMore = rows.rows.length > limit;
    const visible = hasMore ? rows.rows.slice(0, limit) : rows.rows;
    const last = visible.at(-1);
    return {
      logs: visible.map(toDto),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ sortValue: asDate(last.created_at).toISOString(), id: last.id })
          : null,
    };
  }
}
