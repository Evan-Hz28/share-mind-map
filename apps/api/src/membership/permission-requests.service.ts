import {
  AuditRepository,
  PermissionRequestRepository,
  Phase2RepositoryError,
  type Database,
  type PermissionRequestRecord,
} from "@share-mind-map/database";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { sessionReference } from "../common/audit/session-reference.js";
import { ApiError } from "../platform/errors/api-error.js";
import type {
  PermissionRequestDto,
  PermissionRequestListDto,
  PermissionRequestQueryDto,
  PermissionRequestResponseDto,
  RevokeEditingResponseDto,
} from "./dto/permission-request.dto.js";

function toDto(request: PermissionRequestRecord): PermissionRequestDto {
  return {
    id: request.id,
    workspaceId: request.workspaceId,
    requesterId: request.requesterId,
    requesterDisplayName: request.requesterDisplayName,
    status: request.status,
    requestedAt: request.requestedAt.toISOString(),
    decidedBy: request.decidedBy,
    decidedAt: request.decidedAt?.toISOString() ?? null,
  };
}

function mapError(error: unknown): never {
  if (error instanceof Phase2RepositoryError) {
    switch (error.code) {
      case "EDIT_PERMISSION_ALREADY_GRANTED":
        throw new ApiError("EDIT_REQUEST_TERMINAL");
      case "DOCUMENT_NOT_IN_WORKSPACE":
        throw new ApiError("PERMISSION_DENIED");
      default:
        throw new ApiError("NOT_FOUND");
    }
  }
  const databaseError = error as {
    constraint?: unknown;
    cause?: { constraint?: unknown };
  };
  const constraint = databaseError.constraint ?? databaseError.cause?.constraint;
  if (constraint === "edit_permission_requests_pending_uq")
    throw new ApiError("EDIT_REQUEST_PENDING");
  throw error;
}

@Injectable()
export class PermissionRequestsService {
  private readonly requests = new PermissionRequestRepository();
  private readonly audits = new AuditRepository();

  public constructor(@Inject(AUTH_DATABASE) private readonly database: Database) {}

  private assertWorkspace(auth: AuthContext, workspaceId: string): void {
    if (auth.session.workspaceId !== workspaceId) throw new ApiError("PERMISSION_DENIED");
  }

  private async organizationForWorkspace(
    transaction: import("@share-mind-map/database").DatabaseTransaction,
    workspaceId: string,
  ): Promise<string> {
    const result = await transaction.execute<{ organization_id: string }>(sql`
      SELECT organization_id FROM workspaces WHERE id = ${workspaceId}
    `);
    const organizationId = result.rows[0]?.organization_id;
    if (organizationId === undefined) throw new ApiError("NOT_FOUND");
    return organizationId;
  }

  public async submit(
    auth: AuthContext,
    workspaceId: string,
    requestId: string,
  ): Promise<PermissionRequestResponseDto> {
    this.assertWorkspace(auth, workspaceId);
    try {
      const result = await this.database.transaction(async (transaction) => {
        const organizationId = await this.organizationForWorkspace(transaction, workspaceId);
        const created = await this.requests.createPending(transaction, {
          workspaceId,
          requesterId: auth.session.userId,
        });
        if (created.created) {
          await this.audits.append(transaction, {
            organizationId,
            workspaceId,
            actorUserId: auth.session.userId,
            actorSessionId: sessionReference(auth.sessionToken),
            action: "edit_request.created",
            targetType: "edit_permission_request",
            targetId: created.request.id,
            result: "success",
            requestId,
            fromVersion: null,
            toVersion: null,
            metadata: {},
          });
        }
        return created;
      });
      return { request: toDto(result.request), changed: result.created };
    } catch (error) {
      return mapError(error);
    }
  }

  public async list(
    auth: AuthContext,
    query: PermissionRequestQueryDto,
  ): Promise<PermissionRequestListDto> {
    const result = await this.requests.list(
      this.database,
      auth.session.workspaceId,
      query.status ?? null,
      query.cursor ?? null,
      query.limit,
    );
    return { requests: result.requests.map(toDto), nextCursor: result.nextCursor };
  }

  public async decide(
    auth: AuthContext,
    requestId: string,
    decision: "approved" | "rejected",
    requestTraceId: string,
  ): Promise<PermissionRequestResponseDto> {
    try {
      const result = await this.database.transaction(async (transaction) => {
        const organizationId = await this.organizationForWorkspace(
          transaction,
          auth.session.workspaceId,
        );
        const decisionResult = await this.requests.decide(transaction, {
          workspaceId: auth.session.workspaceId,
          requestId,
          actorUserId: auth.session.userId,
          decision,
        });
        if (
          decisionResult.request.status !== decision &&
          decisionResult.request.status !== "pending" &&
          !decisionResult.changed
        ) {
          throw new ApiError("EDIT_REQUEST_TERMINAL");
        }
        if (decisionResult.changed) {
          await this.audits.append(transaction, {
            organizationId,
            workspaceId: auth.session.workspaceId,
            actorUserId: auth.session.userId,
            actorSessionId: sessionReference(auth.sessionToken),
            action: `edit_request.${decision}`,
            targetType: "edit_permission_request",
            targetId: requestId,
            result: "success",
            requestId: requestTraceId,
            fromVersion: null,
            toVersion: null,
            metadata: { status: decision },
          });
        }
        return decisionResult;
      });
      return { request: toDto(result.request), changed: result.changed };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return mapError(error);
    }
  }

  public async revokeEditing(
    auth: AuthContext,
    membershipId: string,
    requestId: string,
  ): Promise<RevokeEditingResponseDto> {
    try {
      return await this.database.transaction(async (transaction) => {
        const organizationId = await this.organizationForWorkspace(
          transaction,
          auth.session.workspaceId,
        );
        const result = await this.requests.revokeEditing(transaction, {
          workspaceId: auth.session.workspaceId,
          membershipId,
          actorUserId: auth.session.userId,
        });
        if (result.changed) {
          await this.audits.append(transaction, {
            organizationId,
            workspaceId: auth.session.workspaceId,
            actorUserId: auth.session.userId,
            actorSessionId: sessionReference(auth.sessionToken),
            action: "edit_permission.revoked",
            targetType: "membership",
            targetId: membershipId,
            result: "success",
            requestId,
            fromVersion: null,
            toVersion: null,
            metadata: { role: "reader" },
          });
        }
        return result;
      });
    } catch (error) {
      return mapError(error);
    }
  }
}
