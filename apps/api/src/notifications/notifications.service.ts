import {
  AuditRepository,
  decodeCursor,
  encodeCursor,
  type Database,
} from "@share-mind-map/database";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { sessionReference } from "../common/audit/session-reference.js";
import { ApiError } from "../platform/errors/api-error.js";
import type {
  NotificationDto,
  NotificationListQueryDto,
  NotificationListResponseDto,
  NotificationReadAllResponseDto,
} from "./dto/notification.dto.js";

interface NotificationRow extends Record<string, unknown> {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  target_type: string | null;
  target_id: string | null;
  read_at: Date | string | null;
  created_at: Date | string;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    notificationType: row.notification_type,
    title: row.title,
    body: row.body,
    targetType: row.target_type,
    targetId: row.target_id,
    readAt: row.read_at === null ? null : asDate(row.read_at).toISOString(),
    createdAt: asDate(row.created_at).toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  private readonly audits = new AuditRepository();

  public constructor(@Inject(AUTH_DATABASE) private readonly database: Database) {}

  public async list(
    auth: AuthContext,
    query: NotificationListQueryDto,
  ): Promise<NotificationListResponseDto> {
    const limit = Math.min(Math.max(query.limit, 1), 100);
    const values: unknown[] = [auth.session.userId];
    let cursorClause = "";
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      values.push(cursor.sortValue, cursor.id);
      cursorClause = "AND (created_at, id) < ($2::timestamptz, $3::uuid)";
    }
    values.push(limit + 1);
    const rows = await this.database.$client.query<NotificationRow>(
      `SELECT id, notification_type, title, body, target_type, target_id, read_at, created_at
       FROM notifications
       WHERE user_id = $1 ${cursorClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${String(values.length)}`,
      values,
    );
    const hasMore = rows.rows.length > limit;
    const visible = hasMore ? rows.rows.slice(0, limit) : rows.rows;
    const unread = await this.database.$client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL",
      [auth.session.userId],
    );
    const last = visible.at(-1);
    return {
      notifications: visible.map(toDto),
      unreadCount: unread.rows[0]?.count ?? 0,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ sortValue: asDate(last.created_at).toISOString(), id: last.id })
          : null,
    };
  }

  public async read(
    auth: AuthContext,
    notificationId: string,
    requestId: string,
  ): Promise<NotificationDto> {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.execute<NotificationRow>(sql`
        UPDATE notifications
        SET read_at = COALESCE(read_at, now())
        WHERE id = ${notificationId} AND user_id = ${auth.session.userId}
        RETURNING id, notification_type, title, body, target_type, target_id, read_at, created_at
      `);
      const row = result.rows[0];
      if (row === undefined) throw new ApiError("NOTIFICATION_NOT_FOUND");
      const workspace = await transaction.execute<{
        organization_id: string;
        workspace_id: string;
      }>(sql`
        SELECT w.organization_id, n.workspace_id
        FROM notifications n JOIN workspaces w ON w.id = n.workspace_id
        WHERE n.id = ${notificationId}
      `);
      const scope = workspace.rows[0];
      if (scope === undefined) throw new ApiError("NOTIFICATION_NOT_FOUND");
      await this.audits.append(transaction, {
        organizationId: scope.organization_id,
        workspaceId: scope.workspace_id,
        actorUserId: auth.session.userId,
        actorSessionId: sessionReference(auth.sessionToken),
        action: "notification.read",
        targetType: "notification",
        targetId: notificationId,
        result: "success",
        requestId,
        fromVersion: null,
        toVersion: null,
        metadata: {},
      });
      return toDto(row);
    });
  }

  public async readAll(
    auth: AuthContext,
    requestId: string,
  ): Promise<NotificationReadAllResponseDto> {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.execute<{ count: number }>(sql`
        WITH changed AS (
          UPDATE notifications SET read_at = now()
          WHERE user_id = ${auth.session.userId} AND read_at IS NULL
          RETURNING workspace_id
        )
        SELECT count(*)::int AS count FROM changed
      `);
      const scope = await transaction.execute<{ organization_id: string }>(sql`
        SELECT o.id AS organization_id
        FROM workspaces w JOIN organizations o ON o.id = w.organization_id
        WHERE w.id = ${auth.session.workspaceId}
      `);
      const organizationId = scope.rows[0]?.organization_id;
      if (organizationId === undefined) throw new ApiError("NOT_FOUND");
      await this.audits.append(transaction, {
        organizationId,
        workspaceId: auth.session.workspaceId,
        actorUserId: auth.session.userId,
        actorSessionId: sessionReference(auth.sessionToken),
        action: "notification.read_all",
        targetType: "user",
        targetId: auth.session.userId,
        result: "success",
        requestId,
        fromVersion: null,
        toVersion: null,
        metadata: { markedCount: result.rows[0]?.count ?? 0 },
      });
      return { markedCount: result.rows[0]?.count ?? 0 };
    });
  }
}
