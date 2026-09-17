import { createHash } from "node:crypto";

import {
  AuditRepository,
  MemberRepository,
  newId,
  type Database,
  type MemberRecord,
} from "@share-mind-map/database";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { normalizeLoginName } from "../auth/password/password-policy.js";
import { PasswordService } from "../auth/password/password.service.js";
import { SessionStore } from "../auth/session/session.store.js";
import type { SessionRole } from "../auth/session/session.types.js";
import { ApiError } from "../platform/errors/api-error.js";
import type { ChangeAccountStatusDto } from "./dto/change-account-status.dto.js";
import type { CreateMemberDto } from "./dto/create-member.dto.js";
import type { MemberResponseDto } from "./dto/member-response.dto.js";

interface TargetMember extends Record<string, unknown> {
  membershipId: string;
  userId: string;
  organizationId: string;
  workspaceId: string;
  role: SessionRole;
  membershipStatus: string;
  accountStatus: "active" | "disabled";
  identityId: string;
  loginName: string;
  displayName: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | string | null;
}

function validRole(value: string): value is SessionRole {
  return value === "reader" || value === "editor" || value === "admin";
}

function isoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeMember(record: MemberRecord): MemberResponseDto {
  if (
    record.loginName === null ||
    record.mustChangePassword === null ||
    !validRole(record.role) ||
    (record.accountStatus !== "active" && record.accountStatus !== "disabled")
  ) {
    throw new ApiError("INTERNAL_ERROR");
  }
  return {
    id: record.id,
    userId: record.userId,
    displayName: record.displayName,
    loginName: record.loginName,
    role: record.role,
    accountStatus: record.accountStatus,
    mustChangePassword: record.mustChangePassword,
    lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
  };
}

@Injectable()
export class MembersService {
  private readonly members: MemberRepository;
  private readonly audits = new AuditRepository();

  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionStore,
  ) {
    this.members = new MemberRepository(database);
  }

  public async list(auth: AuthContext): Promise<MemberResponseDto[]> {
    return (await this.members.list(auth.session.workspaceId)).map(safeMember);
  }

  public async create(
    auth: AuthContext,
    input: CreateMemberDto,
    requestId: string,
  ): Promise<{ member: MemberResponseDto; temporaryPassword: string }> {
    const normalizedLogin = normalizeLoginName(input.loginName);
    const displayName = input.displayName.trim();
    if (displayName.length === 0) throw new ApiError("INVALID_INPUT", { field: "displayName" });
    const temporaryPassword = this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const userId = newId();
    const membershipId = newId();
    const organization = await this.organizationForWorkspace(auth.session.workspaceId);
    try {
      await this.database.transaction(async (transaction) => {
        await transaction.execute(
          sql`INSERT INTO users (id, display_name, account_status, created_by)
              VALUES (${userId}, ${displayName}, 'active', ${auth.session.userId})`,
        );
        await transaction.execute(
          sql`INSERT INTO auth_identities
                (id, organization_id, user_id, provider, provider_subject, login_name,
                 password_hash, must_change_password)
              VALUES (${newId()}, ${organization.id}, ${userId}, 'local', ${normalizedLogin},
                      ${input.loginName}, ${passwordHash}, true)`,
        );
        await transaction.execute(
          sql`INSERT INTO workspace_memberships
                (id, workspace_id, user_id, role, status, granted_by)
              VALUES (${membershipId}, ${auth.session.workspaceId}, ${userId}, 'reader', 'active',
                      ${auth.session.userId})`,
        );
        await this.audits.append(transaction, {
          organizationId: organization.id,
          workspaceId: auth.session.workspaceId,
          actorUserId: auth.session.userId,
          actorSessionId: this.sessionReference(auth.sessionToken),
          action: "admin.member.created",
          targetType: "user",
          targetId: userId,
          result: "success",
          requestId,
          fromVersion: null,
          toVersion: null,
          metadata: { role: "reader" },
        });
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ApiError("LOGIN_NAME_CONFLICT");
      throw error;
    }
    return {
      member: {
        id: membershipId,
        userId,
        displayName,
        loginName: input.loginName,
        role: "reader",
        accountStatus: "active",
        mustChangePassword: true,
        lastLoginAt: null,
      },
      temporaryPassword,
    };
  }

  public async resetPassword(
    auth: AuthContext,
    membershipId: string,
    requestId: string,
  ): Promise<string> {
    const temporaryPassword = this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    await this.database.transaction(async (transaction) => {
      const target = await transaction.execute<TargetMember>(sql`
        SELECT wm.id AS "membershipId", u.id AS "userId", w.organization_id AS "organizationId",
               wm.workspace_id AS "workspaceId", wm.role, wm.status AS "membershipStatus",
               u.account_status AS "accountStatus", ai.id AS "identityId",
               ai.login_name AS "loginName", u.display_name AS "displayName",
               ai.must_change_password AS "mustChangePassword", u.last_login_at AS "lastLoginAt"
        FROM workspace_memberships wm
        JOIN users u ON u.id = wm.user_id
        JOIN workspaces w ON w.id = wm.workspace_id
        JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'local'
        WHERE wm.id = ${membershipId} AND wm.workspace_id = ${auth.session.workspaceId}
        FOR UPDATE OF wm, u, ai
      `);
      const row = target.rows[0];
      if (row === undefined) throw new ApiError("INVALID_INPUT", { field: "memberId" });
      await transaction.execute(
        sql`UPDATE auth_identities
            SET password_hash = ${passwordHash}, must_change_password = true,
                password_changed_at = now(), updated_at = now()
            WHERE id = ${row.identityId}`,
      );
      await this.revokeAll(row.userId);
      await this.audits.append(transaction, {
        organizationId: row.organizationId,
        workspaceId: row.workspaceId,
        actorUserId: auth.session.userId,
        actorSessionId: this.sessionReference(auth.sessionToken),
        action: "admin.member.password_reset",
        targetType: "user",
        targetId: row.userId,
        result: "success",
        requestId,
        fromVersion: null,
        toVersion: null,
        metadata: {},
      });
    });
    return temporaryPassword;
  }

  public async changeStatus(
    auth: AuthContext,
    membershipId: string,
    input: ChangeAccountStatusDto,
    requestId: string,
  ): Promise<MemberResponseDto> {
    return this.database.transaction(async (transaction) => {
      let activeAdminCount = 0;
      if (input.status === "disabled") {
        const lockedAdmins = await transaction.execute<{ accountStatus: string }>(sql`
          SELECT u.account_status AS "accountStatus"
          FROM workspace_memberships wm
          JOIN users u ON u.id = wm.user_id
          WHERE wm.workspace_id = ${auth.session.workspaceId}
            AND wm.role = 'admin' AND wm.status = 'active'
          ORDER BY wm.id
          FOR UPDATE OF wm, u
        `);
        activeAdminCount = lockedAdmins.rows.filter(
          ({ accountStatus }) => accountStatus === "active",
        ).length;
      }
      const target = await transaction.execute<TargetMember>(sql`
        SELECT wm.id AS "membershipId", u.id AS "userId", w.organization_id AS "organizationId",
               wm.workspace_id AS "workspaceId", wm.role, wm.status AS "membershipStatus",
               u.account_status AS "accountStatus", ai.id AS "identityId",
               ai.login_name AS "loginName", u.display_name AS "displayName",
               ai.must_change_password AS "mustChangePassword", u.last_login_at AS "lastLoginAt"
        FROM workspace_memberships wm
        JOIN users u ON u.id = wm.user_id
        JOIN workspaces w ON w.id = wm.workspace_id
        JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'local'
        WHERE wm.id = ${membershipId} AND wm.workspace_id = ${auth.session.workspaceId}
        FOR UPDATE OF wm, u, ai
      `);
      const row = target.rows[0];
      if (row === undefined || !validRole(row.role)) {
        throw new ApiError("INVALID_INPUT", { field: "memberId" });
      }
      if (
        input.status === "disabled" &&
        row.role === "admin" &&
        row.accountStatus === "active" &&
        activeAdminCount <= 1
      ) {
        throw new ApiError("LAST_ACTIVE_ADMIN");
      }
      await transaction.execute(
        sql`UPDATE users SET account_status = ${input.status}, updated_at = now()
            WHERE id = ${row.userId}`,
      );
      if (input.status === "disabled") await this.revokeAll(row.userId);
      await this.audits.append(transaction, {
        organizationId: row.organizationId,
        workspaceId: row.workspaceId,
        actorUserId: auth.session.userId,
        actorSessionId: this.sessionReference(auth.sessionToken),
        action: input.status === "disabled" ? "admin.member.disabled" : "admin.member.restored",
        targetType: "user",
        targetId: row.userId,
        result: "success",
        requestId,
        fromVersion: null,
        toVersion: null,
        metadata: {},
      });
      return {
        id: row.membershipId,
        userId: row.userId,
        displayName: row.displayName,
        loginName: row.loginName,
        role: row.role,
        accountStatus: input.status,
        mustChangePassword: row.mustChangePassword,
        lastLoginAt: isoDate(row.lastLoginAt),
      };
    });
  }

  public async revokeSessions(
    auth: AuthContext,
    membershipId: string,
    requestId: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const target = await transaction.execute<{
        userId: string;
        organizationId: string;
        workspaceId: string;
      }>(sql`
        SELECT u.id AS "userId", w.organization_id AS "organizationId",
               wm.workspace_id AS "workspaceId"
        FROM workspace_memberships wm
        JOIN users u ON u.id = wm.user_id
        JOIN workspaces w ON w.id = wm.workspace_id
        WHERE wm.id = ${membershipId} AND wm.workspace_id = ${auth.session.workspaceId}
        FOR UPDATE OF wm, u
      `);
      const row = target.rows[0];
      if (row === undefined) throw new ApiError("INVALID_INPUT", { field: "memberId" });
      await this.revokeAll(row.userId);
      await this.audits.append(transaction, {
        organizationId: row.organizationId,
        workspaceId: row.workspaceId,
        actorUserId: auth.session.userId,
        actorSessionId: this.sessionReference(auth.sessionToken),
        action: "admin.member.sessions_revoked",
        targetType: "user",
        targetId: row.userId,
        result: "success",
        requestId,
        fromVersion: null,
        toVersion: null,
        metadata: {},
      });
    });
  }

  private async organizationForWorkspace(workspaceId: string): Promise<{ id: string }> {
    const result = await this.database.$client.query<{ id: string }>(
      `SELECT organization_id AS id FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new ApiError("AUTH_SESSION_EXPIRED");
    return row;
  }

  private async revokeAll(userId: string): Promise<void> {
    try {
      await this.sessions.revokeAll(userId);
    } catch {
      throw new ApiError("DEPENDENCY_UNAVAILABLE", { dependency: "redis" });
    }
  }

  private sessionReference(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "cause" in error &&
      typeof error.cause === "object" &&
      error.cause !== null &&
      "code" in error.cause &&
      error.cause.code === "23505"
    );
  }
}
