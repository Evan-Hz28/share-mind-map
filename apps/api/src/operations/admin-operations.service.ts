import { AuditRepository, newId, type Database } from "@share-mind-map/database";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { AdminCommandIO } from "../cli/admin-command-io.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { normalizeLoginName } from "../auth/password/password-policy.js";
import { PasswordService } from "../auth/password/password.service.js";
import { SessionStore } from "../auth/session/session.store.js";
import { ApiError } from "../platform/errors/api-error.js";

export type InitializeAdminResult =
  | { status: "initialized"; organizationId: string; workspaceId: string; userId: string }
  | { status: "already_initialized" }
  | { status: "cancelled" };

export type RecoverAdminResult = { status: "recovered"; userId: string } | { status: "cancelled" };

const operationsLock = 7_315_092_001;

function requiredName(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || Array.from(normalized).length > maximum) {
    throw new ApiError("INVALID_INPUT", { field });
  }
  return normalized;
}

@Injectable()
export class AdminOperationsService {
  private readonly audits = new AuditRepository();

  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionStore,
  ) {}

  public async initialize(io: AdminCommandIO): Promise<InitializeAdminResult> {
    if (await this.isInitialized()) return { status: "already_initialized" };
    const organizationName = requiredName(
      await io.input("Organization name"),
      "organizationName",
      100,
    );
    const workspaceName = requiredName(await io.input("Workspace name"), "workspaceName", 100);
    const enteredLogin = await io.input("Administrator login name");
    const loginName = normalizeLoginName(enteredLogin);
    const displayName = requiredName(
      await io.input("Administrator display name"),
      "displayName",
      255,
    );
    if (!(await io.confirm("Create the first administrator?"))) return { status: "cancelled" };
    const temporaryPassword = this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const organizationId = newId();
    const workspaceId = newId();
    const userId = newId();
    const identityId = newId();
    const membershipId = newId();
    const result = await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(${operationsLock})`);
      const existing = await transaction.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM organizations`,
      );
      if ((existing.rows[0]?.count ?? 0) > 0) return { status: "already_initialized" } as const;
      await transaction.execute(
        sql`INSERT INTO organizations (id, name) VALUES (${organizationId}, ${organizationName})`,
      );
      await transaction.execute(
        sql`INSERT INTO workspaces (id, organization_id, name)
            VALUES (${workspaceId}, ${organizationId}, ${workspaceName})`,
      );
      await transaction.execute(
        sql`INSERT INTO users (id, display_name, account_status)
            VALUES (${userId}, ${displayName}, 'active')`,
      );
      await transaction.execute(
        sql`INSERT INTO auth_identities
              (id, organization_id, user_id, provider, provider_subject, login_name,
               password_hash, must_change_password)
            VALUES (${identityId}, ${organizationId}, ${userId}, 'local', ${loginName},
                    ${enteredLogin}, ${passwordHash}, true)`,
      );
      await transaction.execute(
        sql`INSERT INTO workspace_memberships
              (id, workspace_id, user_id, role, status, granted_by)
            VALUES (${membershipId}, ${workspaceId}, ${userId}, 'admin', 'active', ${userId})`,
      );
      await this.audits.append(transaction, {
        organizationId,
        workspaceId,
        actorUserId: null,
        actorSessionId: null,
        action: "operations.admin.initialized",
        targetType: "user",
        targetId: userId,
        result: "success",
        requestId: newId(),
        fromVersion: null,
        toVersion: null,
        metadata: {},
      });
      return { status: "initialized", organizationId, workspaceId, userId } as const;
    });
    if (result.status === "initialized") {
      await io.secretOnce("Temporary administrator password", temporaryPassword);
    }
    return result;
  }

  public async recover(io: AdminCommandIO): Promise<RecoverAdminResult> {
    const loginName = normalizeLoginName(await io.input("Administrator login name"));
    if (!(await io.confirm("Recover this administrator account?"))) return { status: "cancelled" };
    const temporaryPassword = this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const result = await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(${operationsLock})`);
      const found = await transaction.execute<{
        identityId: string;
        organizationId: string;
        userId: string;
        workspaceId: string;
      }>(sql`
        SELECT ai.id AS "identityId", ai.organization_id AS "organizationId",
               u.id AS "userId", wm.workspace_id AS "workspaceId"
        FROM auth_identities ai
        JOIN users u ON u.id = ai.user_id
        JOIN workspace_memberships wm ON wm.user_id = u.id
        WHERE ai.provider = 'local' AND ai.provider_subject = ${loginName}
          AND wm.role = 'admin' AND wm.status = 'active'
        FOR UPDATE OF ai, u, wm
      `);
      const row = found.rows[0];
      if (row === undefined) throw new ApiError("INVALID_INPUT", { field: "loginName" });
      await transaction.execute(
        sql`UPDATE auth_identities
            SET password_hash = ${passwordHash}, must_change_password = true,
                password_changed_at = now(), updated_at = now()
            WHERE id = ${row.identityId}`,
      );
      await transaction.execute(
        sql`UPDATE users SET account_status = 'active', updated_at = now()
            WHERE id = ${row.userId}`,
      );
      try {
        await this.sessions.revokeAll(row.userId);
      } catch {
        throw new ApiError("DEPENDENCY_UNAVAILABLE", { dependency: "redis" });
      }
      await this.audits.append(transaction, {
        organizationId: row.organizationId,
        workspaceId: row.workspaceId,
        actorUserId: null,
        actorSessionId: null,
        action: "operations.admin.recovered",
        targetType: "user",
        targetId: row.userId,
        result: "success",
        requestId: newId(),
        fromVersion: null,
        toVersion: null,
        metadata: {},
      });
      return { status: "recovered", userId: row.userId } as const;
    });
    await io.secretOnce("Temporary administrator password", temporaryPassword);
    return result;
  }

  private async isInitialized(): Promise<boolean> {
    const result = await this.database.$client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM organizations",
    );
    return (result.rows[0]?.count ?? 0) > 0;
  }
}
