import { Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { getAuthContext } from "../../auth/auth-context.js";
import type { SessionRole } from "../../auth/session/session.types.js";
import { ApiError } from "../../platform/errors/api-error.js";
import { rolesMetadataKey } from "../decorators/roles.js";

const roleRank: Record<SessionRole, number> = { reader: 0, editor: 1, admin: 2 };

@Injectable()
export class RolesGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<readonly SessionRole[] | undefined>(
      rolesMetadataKey,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles === undefined || requiredRoles.length === 0) return true;
    const { session } = getAuthContext(context.switchToHttp().getRequest<Request>());
    if (requiredRoles.some((required) => roleRank[session.role] >= roleRank[required])) return true;
    throw new ApiError("PERMISSION_DENIED");
  }
}
