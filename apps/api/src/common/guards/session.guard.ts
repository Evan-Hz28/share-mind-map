import { Inject, Injectable, Optional } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import type { Database } from "@share-mind-map/database";

import { setAuthContext } from "../../auth/auth-context.js";
import { CsrfService } from "../../auth/csrf/csrf.service.js";
import { AUTH_DATABASE } from "../../auth/auth.tokens.js";
import type { SessionRecord } from "../../auth/session/session.types.js";
import { ApiError } from "../../platform/errors/api-error.js";

export interface SessionLookup {
  get(token: string): Promise<SessionRecord | null>;
}

export const SESSION_LOOKUP = Symbol("SESSION_LOOKUP");

function sessionCookie(request: Request): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  const values = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("smm_session="))
    .map((part) => part.slice("smm_session=".length));
  return values.length === 1 && values[0] !== "" ? values[0] : undefined;
}

@Injectable()
export class SessionGuard implements CanActivate {
  public constructor(
    @Inject(SESSION_LOOKUP) private readonly sessions: SessionLookup,
    private readonly csrf: CsrfService,
    @Optional() @Inject(AUTH_DATABASE) private readonly database?: Database,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = sessionCookie(request);
    if (token === undefined) throw new ApiError("AUTH_REQUIRED");
    const session = await this.sessions.get(token);
    if (session === null) throw new ApiError("AUTH_SESSION_EXPIRED");
    this.csrf.assertRequest(request.method, request.header("x-csrf-token"), session.csrfDigest);
    const effectiveSession = await this.refreshMembership(session);
    setAuthContext(request, { session: effectiveSession, sessionToken: token });
    return true;
  }

  private async refreshMembership(session: SessionRecord): Promise<SessionRecord> {
    if (this.database === undefined) return session;
    const result = await this.database.$client.query<{
      role: SessionRecord["role"];
      membership_status: string;
      account_status: string;
    }>(
      `SELECT wm.role, wm.status AS membership_status, u.account_status
       FROM workspace_memberships wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
      [session.workspaceId, session.userId],
    );
    const membership = result.rows[0];
    if (
      membership === undefined ||
      membership.membership_status !== "active" ||
      membership.account_status !== "active"
    ) {
      throw new ApiError("AUTH_SESSION_EXPIRED");
    }
    return { ...session, role: membership.role };
  }
}
