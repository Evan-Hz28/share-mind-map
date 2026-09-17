import { Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import { setAuthContext } from "../../auth/auth-context.js";
import { CsrfService } from "../../auth/csrf/csrf.service.js";
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
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = sessionCookie(request);
    if (token === undefined) throw new ApiError("AUTH_REQUIRED");
    const session = await this.sessions.get(token);
    if (session === null) throw new ApiError("AUTH_SESSION_EXPIRED");
    this.csrf.assertRequest(request.method, request.header("x-csrf-token"), session.csrfDigest);
    setAuthContext(request, { session, sessionToken: token });
    return true;
  }
}
