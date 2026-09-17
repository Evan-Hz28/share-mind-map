import { Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import { getAuthContext } from "../../auth/auth-context.js";
import { ApiError } from "../../platform/errors/api-error.js";

const forcedChangeRoutes = new Set([
  "GET /api/v1/auth/csrf",
  "GET /api/v1/me",
  "PUT /api/v1/auth/password",
  "POST /api/v1/auth/logout",
]);

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const { session } = getAuthContext(request);
    if (!session.mustChangePassword) return true;
    if (forcedChangeRoutes.has(`${request.method.toUpperCase()} ${request.path}`)) return true;
    throw new ApiError("AUTH_PASSWORD_CHANGE_REQUIRED");
  }
}
