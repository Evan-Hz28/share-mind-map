import type { Request } from "express";

import { ApiError } from "../platform/errors/api-error.js";
import type { SessionRecord } from "./session/session.types.js";

const authContextKey: unique symbol = Symbol("authContext");

export interface AuthContext {
  session: SessionRecord;
  sessionToken: string;
}

interface RequestWithAuthContext extends Request {
  [authContextKey]?: AuthContext;
}

export function setAuthContext(request: Request, context: AuthContext): void {
  (request as RequestWithAuthContext)[authContextKey] = context;
}

export function getAuthContext(request: Request): AuthContext {
  const context = (request as RequestWithAuthContext)[authContextKey];
  if (context === undefined) throw new ApiError("AUTH_REQUIRED");
  return context;
}
