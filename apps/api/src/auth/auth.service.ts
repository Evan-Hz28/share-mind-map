import { createHash } from "node:crypto";

import { AuditRepository, IdentityRepository, type Database } from "@share-mind-map/database";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { AuthContext } from "./auth-context.js";
import { AUTH_DATABASE } from "./auth.tokens.js";
import { CsrfService } from "./csrf/csrf.service.js";
import type { ChangePasswordDto } from "./dto/change-password.dto.js";
import type { LoginDto } from "./dto/login.dto.js";
import type { LoginResponseDto, SessionResponseDto } from "./dto/session-response.dto.js";
import { normalizeLoginName } from "./password/password-policy.js";
import { PasswordService } from "./password/password.service.js";
import { LoginRateLimitService } from "./rate-limit/login-rate-limit.service.js";
import { SessionStore } from "./session/session.store.js";
import type { SessionPrincipal, SessionRole } from "./session/session.types.js";
import { ApiError } from "../platform/errors/api-error.js";

interface SafeSessionRow {
  userId: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  workspaceId: string;
  workspaceName: string;
}

interface LoginRequestContext {
  sourceAddress: string;
  requestId: string;
}

const permissions: Record<SessionRole, string[]> = {
  reader: ["workspace:read"],
  editor: ["workspace:read", "workspace:edit"],
  admin: ["workspace:read", "workspace:edit", "workspace:admin"],
};

function sessionReference(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isRole(value: string): value is SessionRole {
  return value === "reader" || value === "editor" || value === "admin";
}

@Injectable()
export class AuthService {
  private readonly identities: IdentityRepository;
  private readonly audits = new AuditRepository();
  private readonly dummyHash: Promise<string>;

  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionStore,
    private readonly rateLimits: LoginRateLimitService,
    private readonly csrf: CsrfService,
  ) {
    this.identities = new IdentityRepository(database);
    this.dummyHash = passwords.hash("Dummy-Authentication-Password-1");
  }

  public async login(
    input: LoginDto,
    context: LoginRequestContext,
  ): Promise<{ response: LoginResponseDto; token: string }> {
    const normalized = normalizeLoginName(input.loginName);
    await this.rateLimits.assertAllowed(normalized, context.sourceAddress);
    const organization = await this.database.$client.query<{ id: string }>(
      "SELECT id FROM organizations ORDER BY created_at LIMIT 1",
    );
    const organizationId = organization.rows[0]?.id;
    const principal =
      organizationId === undefined
        ? null
        : await this.identities.findLocalBySubject(organizationId, normalized);
    const passwordHash = principal?.identity.passwordHash ?? (await this.dummyHash);
    const passwordMatches = await this.passwords.verify(passwordHash, input.password);
    if (principal === null || !passwordMatches || !isRole(principal.membership.role)) {
      await this.rateLimits.recordFailure(normalized, context.sourceAddress);
      if (organizationId !== undefined) {
        await this.database.transaction(async (transaction) => {
          await this.audits.append(transaction, {
            organizationId,
            workspaceId: null,
            actorUserId: null,
            actorSessionId: null,
            action: "auth.login.failed",
            targetType: "auth_identity",
            targetId: null,
            result: "failure",
            requestId: context.requestId,
            fromVersion: null,
            toVersion: null,
            metadata: { credentialResult: "invalid" },
          });
        });
      }
      throw new ApiError("AUTH_INVALID_CREDENTIALS");
    }

    const sessionPrincipal: SessionPrincipal = {
      userId: principal.user.id,
      workspaceId: principal.membership.workspaceId,
      role: principal.membership.role,
      mustChangePassword: principal.identity.mustChangePassword,
    };
    const created = await this.sessions.create(sessionPrincipal);
    try {
      await this.database.transaction(async (transaction) => {
        await transaction.execute(
          sql`UPDATE users SET last_login_at = now(), updated_at = now()
              WHERE id = ${principal.user.id}`,
        );
        await this.audits.append(transaction, {
          organizationId: principal.identity.organizationId,
          workspaceId: principal.membership.workspaceId,
          actorUserId: principal.user.id,
          actorSessionId: sessionReference(created.token),
          action: "auth.login.succeeded",
          targetType: "user",
          targetId: principal.user.id,
          result: "success",
          requestId: context.requestId,
          fromVersion: null,
          toVersion: null,
          metadata: {},
        });
      });
      await this.rateLimits.recordSuccess(normalized);
    } catch (error) {
      await this.sessions.revoke(created.token).catch(() => undefined);
      throw error;
    }
    const response = await this.sessionResponse(sessionPrincipal);
    return {
      response: {
        user: response.user,
        organization: response.organization,
        defaultWorkspace: response.defaultWorkspace,
        role: response.role,
        effectivePermissions: response.effectivePermissions,
        mustChangePassword: response.mustChangePassword,
        csrfToken: created.csrfToken,
      },
      token: created.token,
    };
  }

  public async me(auth: AuthContext): Promise<SessionResponseDto> {
    return this.sessionResponse(auth.session);
  }

  public async rotateCsrf(auth: AuthContext): Promise<string> {
    const value = await this.sessions.rotateCsrf(auth.sessionToken);
    if (value === null) throw new ApiError("AUTH_SESSION_EXPIRED");
    return value;
  }

  public async changePassword(
    auth: AuthContext,
    input: ChangePasswordDto,
    requestId: string,
  ): Promise<void> {
    const identity = await this.database.$client.query<{
      id: string;
      organization_id: string;
      password_hash: string;
    }>(
      `SELECT id, organization_id, password_hash FROM auth_identities
       WHERE user_id = $1 AND provider = 'local'`,
      [auth.session.userId],
    );
    const row = identity.rows[0];
    if (
      row === undefined ||
      !(await this.passwords.verify(row.password_hash, input.currentPassword))
    ) {
      throw new ApiError("AUTH_CURRENT_PASSWORD_INVALID");
    }
    const nextHash = await this.passwords.hash(input.newPassword);
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`UPDATE auth_identities
            SET password_hash = ${nextHash}, must_change_password = false,
                password_changed_at = now(), updated_at = now()
            WHERE id = ${row.id}`,
      );
      await this.revokeAllOrUnavailable(auth.session.userId);
      await this.audits.append(transaction, {
        organizationId: row.organization_id,
        workspaceId: auth.session.workspaceId,
        actorUserId: auth.session.userId,
        actorSessionId: sessionReference(auth.sessionToken),
        action: "auth.password.changed",
        targetType: "user",
        targetId: auth.session.userId,
        result: "success",
        requestId,
        fromVersion: null,
        toVersion: null,
        metadata: {},
      });
    });
  }

  public async logout(
    token: string | undefined,
    csrfValue: string | undefined,
    requestId: string,
  ): Promise<void> {
    if (token === undefined) return;
    const session = await this.sessions.get(token);
    if (session === null) return;
    this.csrf.assertRequest("POST", csrfValue, session.csrfDigest);
    await this.sessions.revoke(token);
    const organization = await this.database.$client.query<{ organization_id: string }>(
      "SELECT organization_id FROM workspaces WHERE id = $1",
      [session.workspaceId],
    );
    const organizationId = organization.rows[0]?.organization_id;
    if (organizationId === undefined) return;
    await this.database.transaction(async (transaction) => {
      await this.audits.append(transaction, {
        organizationId,
        workspaceId: session.workspaceId,
        actorUserId: session.userId,
        actorSessionId: sessionReference(token),
        action: "auth.logout",
        targetType: "user",
        targetId: session.userId,
        result: "success",
        requestId,
        fromVersion: null,
        toVersion: null,
        metadata: {},
      });
    });
  }

  private async sessionResponse(principal: SessionPrincipal): Promise<SessionResponseDto> {
    const result = await this.database.$client.query<SafeSessionRow>(
      `SELECT u.id AS "userId", u.display_name AS "displayName",
              o.id AS "organizationId", o.name AS "organizationName",
              w.id AS "workspaceId", w.name AS "workspaceName"
       FROM users u
       JOIN workspace_memberships wm ON wm.user_id = u.id
       JOIN workspaces w ON w.id = wm.workspace_id
       JOIN organizations o ON o.id = w.organization_id
       WHERE u.id = $1 AND w.id = $2`,
      [principal.userId, principal.workspaceId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new ApiError("AUTH_SESSION_EXPIRED");
    return {
      user: { id: row.userId, displayName: row.displayName },
      organization: { id: row.organizationId, name: row.organizationName },
      defaultWorkspace: { id: row.workspaceId, name: row.workspaceName },
      role: principal.role,
      effectivePermissions: permissions[principal.role],
      mustChangePassword: principal.mustChangePassword,
    };
  }

  private async revokeAllOrUnavailable(userId: string): Promise<void> {
    try {
      await this.sessions.revokeAll(userId);
    } catch {
      throw new ApiError("DEPENDENCY_UNAVAILABLE", { dependency: "redis" });
    }
  }
}
