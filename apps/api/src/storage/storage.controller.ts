import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";

import { getAuthContext } from "../auth/auth-context.js";
import { Roles } from "../common/decorators/roles.js";
import { PasswordChangeGuard } from "../common/guards/password-change.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { SessionGuard } from "../common/guards/session.guard.js";
import { StorageUsageDto } from "./dto/storage.dto.js";
import { StorageService } from "./storage.service.js";

@ApiTags("administration")
@Controller("admin/storage")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
@Roles("admin")
export class StorageController {
  public constructor(private readonly storage: StorageService) {}

  @Get()
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "adminReadStorageUsage" })
  @ApiResponse({ status: 200, type: StorageUsageDto })
  public read(@Req() request: Request): Promise<StorageUsageDto> {
    return this.storage.read(getAuthContext(request));
  }
}
