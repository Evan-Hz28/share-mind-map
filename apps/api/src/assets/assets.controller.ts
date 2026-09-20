import { Controller, Get, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiConsumes,
  ApiOperation,
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
import { AssetsService } from "./assets.service.js";

@ApiTags("assets")
@Controller("workspaces/:workspaceId/documents/:documentId/assets")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
export class AssetsController {
  public constructor(private readonly assets: AssetsService) {}

  @Post()
  @Roles("editor")
  @ApiConsumes("multipart/form-data")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "uploadDocumentAsset" })
  @ApiResponse({ status: 201, description: "Uploaded image asset metadata." })
  public upload(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Req() request: Request,
  ): Promise<{
    asset: { id: string; sourcePath: string; mediaType: string; byteSize: number; sha256: string };
  }> {
    return this.assets.upload(getAuthContext(request), workspaceId, documentId, request);
  }

  @Get(":assetId")
  @Roles("reader")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "readDocumentAsset" })
  @ApiResponse({ status: 200, description: "A current-snapshot-referenced private image." })
  public async read(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Param("assetId", new ParseUUIDPipe({ version: "7" })) assetId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.assets.read(
      getAuthContext(request),
      workspaceId,
      documentId,
      assetId,
    );
    response.status(200).type(result.mediaType);
    result.stream.pipe(response);
  }
}
