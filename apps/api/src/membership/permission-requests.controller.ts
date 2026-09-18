import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";

import { getAuthContext } from "../auth/auth-context.js";
import { Roles } from "../common/decorators/roles.js";
import { PasswordChangeGuard } from "../common/guards/password-change.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { SessionGuard } from "../common/guards/session.guard.js";
import { getRequestId } from "../platform/http/request-id.middleware.js";
import {
  PermissionRequestListDto,
  PermissionRequestQueryDto,
  PermissionRequestResponseDto,
  RevokeEditingResponseDto,
} from "./dto/permission-request.dto.js";
import { PermissionRequestsService } from "./permission-requests.service.js";

@ApiTags("permissions")
@Controller("workspaces/:workspaceId/edit-requests")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
export class PermissionRequestsController {
  public constructor(private readonly requests: PermissionRequestsService) {}

  @Post()
  @Roles("reader")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "createEditPermissionRequest" })
  @ApiResponse({ status: 201, type: PermissionRequestResponseDto })
  public submit(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Req() request: Request,
  ): Promise<PermissionRequestResponseDto> {
    return this.requests.submit(getAuthContext(request), workspaceId, getRequestId(request));
  }
}

@ApiTags("administration")
@Controller("admin/edit-requests")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
@Roles("admin")
export class AdminPermissionRequestsController {
  public constructor(private readonly requests: PermissionRequestsService) {}

  @Get()
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "adminListEditPermissionRequests" })
  @ApiResponse({ status: 200, type: PermissionRequestListDto })
  public list(
    @Query() query: PermissionRequestQueryDto,
    @Req() request: Request,
  ): Promise<PermissionRequestListDto> {
    return this.requests.list(getAuthContext(request), query);
  }

  @Post(":requestId/approve")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "approveEditPermissionRequest" })
  @ApiResponse({ status: 201, type: PermissionRequestResponseDto })
  public approve(
    @Param("requestId", new ParseUUIDPipe({ version: "7" })) requestId: string,
    @Req() request: Request,
  ): Promise<PermissionRequestResponseDto> {
    return this.requests.decide(
      getAuthContext(request),
      requestId,
      "approved",
      getRequestId(request),
    );
  }

  @Post(":requestId/reject")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "rejectEditPermissionRequest" })
  @ApiResponse({ status: 201, type: PermissionRequestResponseDto })
  public reject(
    @Param("requestId", new ParseUUIDPipe({ version: "7" })) requestId: string,
    @Req() request: Request,
  ): Promise<PermissionRequestResponseDto> {
    return this.requests.decide(
      getAuthContext(request),
      requestId,
      "rejected",
      getRequestId(request),
    );
  }
}

@ApiTags("administration")
@Controller("admin/members")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
@Roles("admin")
export class RevokeEditingController {
  public constructor(private readonly requests: PermissionRequestsService) {}

  @Post(":membershipId/revoke-editing")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "revokeMemberEditing" })
  @ApiResponse({ status: 201, type: RevokeEditingResponseDto })
  public revoke(
    @Param("membershipId", new ParseUUIDPipe({ version: "7" })) membershipId: string,
    @Req() request: Request,
  ): Promise<RevokeEditingResponseDto> {
    return this.requests.revokeEditing(
      getAuthContext(request),
      membershipId,
      getRequestId(request),
    );
  }
}
