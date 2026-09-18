import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";

import { getAuthContext } from "../auth/auth-context.js";
import { Roles } from "../common/decorators/roles.js";
import { PasswordChangeGuard } from "../common/guards/password-change.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { SessionGuard } from "../common/guards/session.guard.js";
import { AdminImportFailureListDto, AdminImportFailureQueryDto } from "./dto/import-failure.dto.js";
import { ImportFailuresService } from "./import-failures.service.js";

@ApiTags("administration")
@Controller("admin/import-failures")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
@Roles("admin")
export class ImportFailuresController {
  public constructor(private readonly failures: ImportFailuresService) {}

  @Get()
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "adminListImportFailures" })
  @ApiResponse({ status: 200, type: AdminImportFailureListDto })
  public list(
    @Query() query: AdminImportFailureQueryDto,
    @Req() request: Request,
  ): Promise<AdminImportFailureListDto> {
    return this.failures.list(getAuthContext(request), query);
  }
}
