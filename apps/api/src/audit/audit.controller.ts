import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";

import { getAuthContext } from "../auth/auth-context.js";
import { Roles } from "../common/decorators/roles.js";
import { PasswordChangeGuard } from "../common/guards/password-change.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { SessionGuard } from "../common/guards/session.guard.js";
import { AuditListResponseDto, AuditQueryDto } from "./dto/audit.dto.js";
import { AuditService } from "./audit.service.js";

@ApiTags("administration")
@Controller("admin/audit-logs")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
@Roles("admin")
export class AuditController {
  public constructor(private readonly audits: AuditService) {}

  @Get()
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "adminListAuditLogs" })
  @ApiResponse({ status: 200, type: AuditListResponseDto })
  public list(
    @Query() query: AuditQueryDto,
    @Req() request: Request,
  ): Promise<AuditListResponseDto> {
    return this.audits.list(getAuthContext(request), query);
  }
}
