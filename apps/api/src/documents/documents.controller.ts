import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";

import { getAuthContext } from "../auth/auth-context.js";
import { Roles } from "../common/decorators/roles.js";
import { PasswordChangeGuard } from "../common/guards/password-change.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { SessionGuard } from "../common/guards/session.guard.js";
import { getRequestId } from "../platform/http/request-id.middleware.js";
import { ApiError } from "../platform/errors/api-error.js";
import {
  CreateDocumentDto,
  DocumentListQueryDto,
  UpdateDocumentDto,
} from "./dto/document-input.dto.js";
import { DraftExportDto, SaveSnapshotDto } from "./dto/document-save.dto.js";
import {
  DocumentDetailResponseDto,
  DocumentListResponseDto,
  DocumentResponseDto,
  SnapshotResponseDto,
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

  @Delete(":documentId")
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "deleteDocument" })
  @ApiResponse({ status: 204, description: "Document permanently deleted." })
  public async remove(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.documents.remove(
      getAuthContext(request),
      workspaceId,
      documentId,
      getRequestId(request),
    );
    response.status(204).send();
  }

  @Post(":documentId/snapshots")
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ operationId: "saveDocumentSnapshot" })
  @ApiResponse({ status: 200, type: SnapshotResponseDto })
  @ApiResponse({ status: 201, type: SnapshotResponseDto })
  public async saveSnapshot(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Headers("Idempotency-Key") idempotencyKey: string | undefined,
    @Body() input: SaveSnapshotDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SnapshotResponseDto & { idempotent: boolean }> {
    if (idempotencyKey === undefined) throw new ApiError("INVALID_INPUT");
    const result = await this.documents.saveSnapshot(
      getAuthContext(request),
      workspaceId,
      documentId,
      input,
      idempotencyKey,
      getRequestId(request),
    );
    response.status(result.idempotent ? 200 : 201);
    return result;
  }

  @Post(":documentId/draft-export")
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "exportDocumentDraft" })
  @ApiProduces("application/xmind")
  @ApiResponse({
    status: 200,
    description: "A private XMind export generated from a client draft.",
    content: { "application/xmind": { schema: { type: "string", format: "binary" } } },
  })
  public async draftExport(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Body() input: DraftExportDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.documents.draftExport(
      getAuthContext(request),
      workspaceId,
      documentId,
      input,
    );
    response.status(200);
    response.type("application/xmind");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    );
    response.setHeader("X-XMind-Compatibility", result.compatibilityStatus);
    response.send(result.bytes);
  }
}
