import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";

import { getAuthContext } from "../auth/auth-context.js";
import { Roles } from "../common/decorators/roles.js";
import { PasswordChangeGuard } from "../common/guards/password-change.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { SessionGuard } from "../common/guards/session.guard.js";
import { WorkspaceOverviewDto } from "./dto/overview.dto.js";
import { OverviewService } from "./overview.service.js";

@ApiTags("workspaces")
@Controller("workspaces/:workspaceId/overview")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
export class OverviewController {
  public constructor(private readonly overview: OverviewService) {}

  @Get()
  @Roles("reader")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "getWorkspaceOverview" })
  @ApiResponse({ status: 200, type: WorkspaceOverviewDto })
  public read(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Req() request: Request,
  ): Promise<WorkspaceOverviewDto> {
    return this.overview.read(getAuthContext(request), workspaceId);
  }
}
