import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
  CreateDocumentDto,
  DocumentListQueryDto,
  UpdateDocumentDto,
} from "./dto/document-input.dto.js";
import {
  DocumentDetailResponseDto,
  DocumentListResponseDto,
  DocumentResponseDto,
} from "./dto/document.dto.js";
import { DocumentsService } from "./documents.service.js";

@ApiTags("documents")
@Controller("workspaces/:workspaceId/documents")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
export class DocumentsController {
  public constructor(private readonly documents: DocumentsService) {}

  @Get()
  @Roles("reader")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listDocuments" })
  @ApiResponse({ status: 200, type: DocumentListResponseDto })
  public list(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Query() query: DocumentListQueryDto,
    @Req() request: Request,
  ): Promise<DocumentListResponseDto> {
    return this.documents.list(getAuthContext(request), workspaceId, query);
  }

  @Post()
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "createBlankDocument" })
  @ApiResponse({ status: 201, type: DocumentResponseDto })
  public create(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Body() input: CreateDocumentDto,
    @Req() request: Request,
  ): Promise<DocumentResponseDto> {
    return this.documents.create(
      getAuthContext(request),
      workspaceId,
      input,
      getRequestId(request),
    );
  }

  @Get(":documentId")
  @Roles("reader")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "getDocumentMetadata" })
  @ApiResponse({ status: 200, type: DocumentDetailResponseDto })
  public detail(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Req() request: Request,
  ): Promise<DocumentDetailResponseDto> {
    return this.documents.detail(getAuthContext(request), workspaceId, documentId);
  }

  @Patch(":documentId")
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "updateDocumentMetadata" })
  @ApiResponse({ status: 200, type: DocumentResponseDto })
  public update(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Body() input: UpdateDocumentDto,
    @Req() request: Request,
  ): Promise<DocumentResponseDto> {
    return this.documents.update(
      getAuthContext(request),
      workspaceId,
      documentId,
      input,
      getRequestId(request),
    );
  }
}
