import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import type { Request } from "express";

import { getAuthContext } from "../auth/auth-context.js";
import { Roles } from "../common/decorators/roles.js";
import { PasswordChangeGuard } from "../common/guards/password-change.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { SessionGuard } from "../common/guards/session.guard.js";
import { CreateImportBatchDto } from "./dto/import-input.dto.js";
import { ImportBatchResponseDto, ImportJobResponseDto } from "./dto/import-response.dto.js";
import { ImportUploadDto } from "./dto/import-upload.dto.js";
import { ImportsService } from "./imports.service.js";

@ApiTags("imports")
@Controller("workspaces/:workspaceId/import-batches")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
export class ImportsController {
  public constructor(private readonly imports: ImportsService) {}

  @Post()
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "createImportBatch" })
  @ApiResponse({ status: 201, type: ImportBatchResponseDto })
  public createBatch(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Body() input: CreateImportBatchDto,
    @Req() request: Request,
  ): Promise<ImportBatchResponseDto> {
    return this.imports.createBatch(getAuthContext(request), workspaceId, input);
  }

  @Get(":batchId")
  @Roles("reader")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "getImportBatch" })
  @ApiResponse({ status: 200, type: ImportBatchResponseDto })
  public readBatch(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("batchId", new ParseUUIDPipe({ version: "7" })) batchId: string,
    @Req() request: Request,
  ): Promise<ImportBatchResponseDto> {
    return this.imports.readBatch(getAuthContext(request), workspaceId, batchId);
  }

  @Post(":batchId/jobs/:jobId/upload")
  @Roles("editor")
  @ApiConsumes("multipart/form-data")
  @ApiBody({ type: ImportUploadDto })
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "uploadImportJob" })
  @ApiResponse({ status: 200, type: ImportJobResponseDto })
  public upload(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("batchId", new ParseUUIDPipe({ version: "7" })) batchId: string,
    @Param("jobId", new ParseUUIDPipe({ version: "7" })) jobId: string,
    @Req() request: Request,
  ): Promise<ImportJobResponseDto> {
    return this.imports.upload(getAuthContext(request), workspaceId, batchId, jobId, request);
  }

  @Post(":batchId/jobs/:jobId/cancel")
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "cancelImportJob" })
  @ApiResponse({ status: 200, type: ImportJobResponseDto })
  public cancel(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("batchId", new ParseUUIDPipe({ version: "7" })) batchId: string,
    @Param("jobId", new ParseUUIDPipe({ version: "7" })) jobId: string,
    @Req() request: Request,
  ): Promise<ImportJobResponseDto> {
    return this.imports.cancel(getAuthContext(request), workspaceId, batchId, jobId);
  }

  @Post(":batchId/jobs/:jobId/retry")
  @Roles("editor")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "retryImportJob" })
  @ApiResponse({ status: 200, type: ImportJobResponseDto })
  public retry(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("batchId", new ParseUUIDPipe({ version: "7" })) batchId: string,
    @Param("jobId", new ParseUUIDPipe({ version: "7" })) jobId: string,
    @Req() request: Request,
  ): Promise<ImportJobResponseDto> {
    return this.imports.retry(getAuthContext(request), workspaceId, batchId, jobId);
  }
}
