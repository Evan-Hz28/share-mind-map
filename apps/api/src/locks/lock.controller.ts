import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";

import { getAuthContext } from "../auth/auth-context.js";
import { Roles } from "../common/decorators/roles.js";
import { PasswordChangeGuard } from "../common/guards/password-change.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { SessionGuard } from "../common/guards/session.guard.js";
import { getRequestId } from "../platform/http/request-id.middleware.js";
import {
  AcquireLockDto,
  AcquireLockResponseDto,
  ForceReleaseLockDto,
  HeartbeatLockResponseDto,
  LockLeaseDto,
  LockResponseDto,
} from "./dto/lock.dto.js";
import { LockService } from "./lock.service.js";

@ApiTags("locks")
@Controller("workspaces/:workspaceId/documents/:documentId/lock")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
export class LockController {
  public constructor(private readonly locks: LockService) {}

  @Post()
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "acquireDocumentLock" })
  @ApiResponse({ status: 201, type: AcquireLockResponseDto })
  public acquire(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Body() input: AcquireLockDto,
    @Req() request: Request,
  ): Promise<AcquireLockResponseDto> {
    return this.locks.acquire(getAuthContext(request), workspaceId, documentId, input);
  }

  @Get()
  @Roles("reader")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "inspectDocumentLock" })
  @ApiResponse({ status: 200, type: LockResponseDto })
  public inspect(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Req() request: Request,
  ): Promise<LockResponseDto> {
    return this.locks.inspect(getAuthContext(request), workspaceId, documentId);
  }

  @Post("heartbeat")
  @HttpCode(200)
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "heartbeatDocumentLock" })
  @ApiResponse({ status: 200, type: HeartbeatLockResponseDto })
  public heartbeat(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Body() input: LockLeaseDto,
    @Req() request: Request,
  ): Promise<HeartbeatLockResponseDto> {
    return this.locks.heartbeat(getAuthContext(request), workspaceId, documentId, input);
  }

  @Delete()
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "releaseDocumentLock" })
  @ApiResponse({ status: 200, type: LockResponseDto })
  public release(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Body() input: LockLeaseDto,
    @Req() request: Request,
  ): Promise<LockResponseDto> {
    return this.locks.release(getAuthContext(request), workspaceId, documentId, input);
  }

  @Post("force-release")
  @Roles("admin")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "forceReleaseDocumentLock" })
  @ApiResponse({ status: 201, type: LockResponseDto })
  public forceRelease(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Body() input: ForceReleaseLockDto,
    @Req() request: Request,
  ): Promise<LockResponseDto> {
    return this.locks.forceRelease(
      getAuthContext(request),
      workspaceId,
      documentId,
      input,
      getRequestId(request),
    );
  }
}
