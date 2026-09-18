import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { FolderNameDto } from "./dto/folder-input.dto.js";
import {
  FolderDeleteCheckResponseDto,
  FolderListResponseDto,
  FolderResponseDto,
} from "./dto/folder.dto.js";
import { FoldersService } from "./folders.service.js";

@ApiTags("folders")
@Controller("workspaces/:workspaceId/folders")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
export class FoldersController {
  public constructor(private readonly folders: FoldersService) {}

  @Get()
  @Roles("reader")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listFolders" })
  @ApiResponse({ status: 200, type: FolderListResponseDto })
  public list(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Req() request: Request,
  ): Promise<FolderListResponseDto> {
    return this.folders.list(getAuthContext(request), workspaceId);
  }

  @Post()
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "createFolder" })
  @ApiResponse({ status: 201, type: FolderResponseDto })
  public create(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Body() input: FolderNameDto,
    @Req() request: Request,
  ): Promise<FolderResponseDto> {
    return this.folders.create(getAuthContext(request), workspaceId, input, getRequestId(request));
  }

  @Patch(":folderId")
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "renameFolder" })
  @ApiResponse({ status: 200, type: FolderResponseDto })
  public rename(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("folderId", new ParseUUIDPipe({ version: "7" })) folderId: string,
    @Body() input: FolderNameDto,
    @Req() request: Request,
  ): Promise<FolderResponseDto> {
    return this.folders.rename(
      getAuthContext(request),
      workspaceId,
      folderId,
      input,
      getRequestId(request),
    );
  }

  @Post(":folderId/delete-check")
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "checkFolderDelete" })
  @ApiResponse({ status: 200, type: FolderDeleteCheckResponseDto })
  public checkDelete(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("folderId", new ParseUUIDPipe({ version: "7" })) folderId: string,
    @Req() request: Request,
  ): Promise<FolderDeleteCheckResponseDto> {
    return this.folders.checkDelete(
      getAuthContext(request),
      workspaceId,
      folderId,
      getRequestId(request),
    );
  }
}
