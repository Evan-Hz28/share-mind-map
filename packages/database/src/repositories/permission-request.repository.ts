import { sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { newId } from "../id.js";
import type { DatabaseTransaction } from "./member.repository.js";
import { NotificationRepository } from "./notification.repository.js";
import { Phase2RepositoryError } from "./phase2.types.js";
import { decodeCursor, encodeCursor } from "./cursor.js";

export type PermissionRequestStatus = "pending" | "approved" | "rejected";

export interface PermissionRequestRecord {
  id: string;
  workspaceId: string;
  requesterId: string;
  requesterDisplayName: string;
  status: PermissionRequestStatus;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
}

export interface PermissionDecisionResult {
  request: PermissionRequestRecord;
  changed: boolean;
}

export interface RevokeEditingResult {
  membershipId: string;
  userId: string;
  role: "reader" | "editor" | "admin";
  changed: boolean;
}

interface RequestRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  requester_id: string;
  requester_display_name: string;
  status: PermissionRequestStatus;
  requested_at: Date | string;
  decided_by: string | null;
  decided_at: Date | string | null;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toRecord(row: RequestRow): PermissionRequestRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    requesterId: row.requester_id,
    requesterDisplayName: row.requester_display_name,
    status: row.status,
    requestedAt: asDate(row.requested_at),
    decidedBy: row.decided_by,
    decidedAt: row.decided_at === null ? null : asDate(row.decided_at),
  };
}

const requestColumns = sql`r.id, r.workspace_id, r.requester_id, u.display_name AS requester_display_name,
  r.status, r.requested_at, r.decided_by, r.decided_at`;

export class PermissionRequestRepository {
  private readonly notifications = new NotificationRepository();

  public async createPending(
    transaction: DatabaseTransaction,
    input: { workspaceId: string; requesterId: string },
  ): Promise<{ request: PermissionRequestRecord; created: boolean }> {
    const membership = await transaction.execute<{ role: string; status: string }>(sql`
      SELECT role, status FROM workspace_memberships
      WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.requesterId}
      FOR UPDATE
    `);
    const member = membership.rows[0];
    if (member === undefined || member.status !== "active") {
      throw new Phase2RepositoryError(
        "DOCUMENT_NOT_IN_WORKSPACE",
        "Member does not belong to workspace.",
      );
    }
    if (member.role !== "reader") {
      throw new Phase2RepositoryError(
        "EDIT_PERMISSION_ALREADY_GRANTED",
        "Member already has edit permission.",
      );
    }
    const existing = await transaction.execute<RequestRow>(sql`
      SELECT ${requestColumns}
      FROM edit_permission_requests r
      JOIN users u ON u.id = r.requester_id
      WHERE r.workspace_id = ${input.workspaceId}
        AND r.requester_id = ${input.requesterId}
        AND r.status = 'pending'
      FOR UPDATE OF r
    `);
    const existingRow = existing.rows[0];
    if (existingRow !== undefined) return { request: toRecord(existingRow), created: false };
    const id = newId();
    const result = await transaction.execute<RequestRow>(sql`
      INSERT INTO edit_permission_requests (id, workspace_id, requester_id)
      VALUES (${id}, ${input.workspaceId}, ${input.requesterId})
      RETURNING id, workspace_id, requester_id,
        ${sql.raw("(SELECT display_name FROM users WHERE id = requester_id)")} AS requester_display_name,
        status, requested_at, decided_by, decided_at
    `);
    const row = result.rows[0];
    if (row === undefined) throw new Error("Permission request insert returned no row.");
    const administrators = await transaction.execute<{ user_id: string }>(sql`
      SELECT user_id
      FROM workspace_memberships
      WHERE workspace_id = ${input.workspaceId} AND role = 'admin' AND status = 'active'
    `);
    for (const administrator of administrators.rows) {
      await this.notifications.enqueue(transaction, {
        eventKey: `edit-request:${id}:requested:${administrator.user_id}`,
        eventType: "edit_permission.requested",
        recipientUserId: administrator.user_id,
        workspaceId: input.workspaceId,
        targetType: "edit_permission_request",
        targetId: id,
        payload: {
          title: "收到编辑权限申请",
          body: `${toRecord(row).requesterDisplayName} 申请编辑工作空间文档。`,
        },
      });
    }
    return { request: toRecord(row), created: true };
  }

  public async list(
    database: Database,
    workspaceId: string,
    status: PermissionRequestStatus | null,
    cursor: string | null,
    limit: number,
  ): Promise<{ requests: PermissionRequestRecord[]; nextCursor: string | null }> {
    const params: unknown[] = [workspaceId];
    const filters = ["r.workspace_id = $1"];
    if (status !== null) {
      params.push(status);
      filters.push(`r.status = $${String(params.length)}`);
    }
    if (cursor !== null) {
      const decoded = decodeCursor(cursor);
      params.push(decoded.sortValue, decoded.id);
      filters.push(
        `(r.requested_at, r.id) < ($${String(params.length - 1)}::timestamptz, $${String(params.length)}::uuid)`,
      );
    }
    const pageSize = Math.min(Math.max(limit, 1), 100);
    params.push(pageSize + 1);
    const result = await database.$client.query<RequestRow>(
      `SELECT r.id, r.workspace_id, r.requester_id, u.display_name AS requester_display_name,
              r.status, r.requested_at, r.decided_by, r.decided_at
       FROM edit_permission_requests r
       JOIN users u ON u.id = r.requester_id
       WHERE ${filters.join(" AND ")}
       ORDER BY r.requested_at DESC, r.id DESC
       LIMIT $${String(params.length)}`,
      params,
    );
    const hasMore = result.rows.length > pageSize;
    const visible = hasMore ? result.rows.slice(0, pageSize) : result.rows;
    const requests = visible.map(toRecord);
    const last = requests.at(-1);
    return {
      requests,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ sortValue: last.requestedAt.toISOString(), id: last.id })
          : null,
    };
  }

  private async lockRequest(
    transaction: DatabaseTransaction,
    workspaceId: string,
    requestId: string,
  ): Promise<RequestRow> {
    const result = await transaction.execute<RequestRow>(sql`
      SELECT ${requestColumns}
      FROM edit_permission_requests r
      JOIN users u ON u.id = r.requester_id
      WHERE r.id = ${requestId} AND r.workspace_id = ${workspaceId}
      FOR UPDATE OF r
    `);
    const row = result.rows[0];
    if (row === undefined)
      throw new Phase2RepositoryError(
        "DOCUMENT_NOT_IN_WORKSPACE",
        "Permission request does not belong to workspace.",
      );
    return row;
  }

  public async decide(
    transaction: DatabaseTransaction,
    input: {
      workspaceId: string;
      requestId: string;
      actorUserId: string;
      decision: "approved" | "rejected";
    },
  ): Promise<PermissionDecisionResult> {
    const row = await this.lockRequest(transaction, input.workspaceId, input.requestId);
    if (row.status !== "pending") {
      return { request: toRecord(row), changed: false };
    }
    const membership = await transaction.execute<{ id: string; user_id: string }>(sql`
      SELECT id, user_id FROM workspace_memberships
      WHERE workspace_id = ${input.workspaceId} AND user_id = ${row.requester_id}
      FOR UPDATE
    `);
    const member = membership.rows[0];
    if (member === undefined)
      throw new Phase2RepositoryError(
        "DOCUMENT_NOT_IN_WORKSPACE",
        "Member does not belong to workspace.",
      );
    if (input.decision === "approved") {
      await transaction.execute(sql`
        UPDATE workspace_memberships
        SET role = 'editor', granted_by = ${input.actorUserId}, granted_at = now(), updated_at = now(), revoked_at = NULL
        WHERE id = ${member.id}
      `);
    }
    const result = await transaction.execute<RequestRow>(sql`
      UPDATE edit_permission_requests
      SET status = ${input.decision}, decided_by = ${input.actorUserId}, decided_at = now(), updated_at = now()
      WHERE id = ${input.requestId}
      RETURNING id, workspace_id, requester_id,
        ${sql.raw("(SELECT display_name FROM users WHERE id = requester_id)")} AS requester_display_name,
        status, requested_at, decided_by, decided_at
    `);
    const decided = result.rows[0];
    if (decided === undefined) throw new Error("Permission decision returned no row.");
    await this.notifications.enqueue(transaction, {
      eventKey: `edit-request:${input.requestId}:${input.decision}`,
      eventType: `edit_permission.${input.decision}`,
      recipientUserId: row.requester_id,
      workspaceId: input.workspaceId,
      targetType: "edit_permission_request",
      targetId: input.requestId,
      payload: {
        title: input.decision === "approved" ? "编辑权限申请已通过" : "编辑权限申请已拒绝",
        body:
          input.decision === "approved"
            ? "你现在可以编辑工作空间文档。"
            : "你的编辑权限申请未通过。",
      },
    });
    return { request: toRecord(decided), changed: true };
  }

  public async revokeEditing(
    transaction: DatabaseTransaction,
    input: { workspaceId: string; membershipId: string; actorUserId: string },
  ): Promise<RevokeEditingResult> {
    const result = await transaction.execute<{
      id: string;
      user_id: string;
      role: "reader" | "editor" | "admin";
    }>(sql`
      SELECT id, user_id, role FROM workspace_memberships
      WHERE id = ${input.membershipId} AND workspace_id = ${input.workspaceId} AND status = 'active'
      FOR UPDATE
    `);
    const member = result.rows[0];
    if (member === undefined)
      throw new Phase2RepositoryError(
        "DOCUMENT_NOT_IN_WORKSPACE",
        "Member does not belong to workspace.",
      );
    if (member.role !== "editor")
      return { membershipId: member.id, userId: member.user_id, role: member.role, changed: false };
    await transaction.execute(sql`
      UPDATE workspace_memberships
      SET role = 'reader', revoked_at = now(), updated_at = now()
      WHERE id = ${member.id}
    `);
    await this.notifications.enqueue(transaction, {
      eventKey: `edit-permission:revoke:${member.id}`,
      eventType: "edit_permission.revoked",
      recipientUserId: member.user_id,
      workspaceId: input.workspaceId,
      targetType: "membership",
      targetId: member.id,
      payload: { title: "编辑权限已撤销", body: "你的工作空间编辑权限已恢复为只读。" },
    });
    return { membershipId: member.id, userId: member.user_id, role: "reader", changed: true };
  }
}
