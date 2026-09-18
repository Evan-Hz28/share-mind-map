import { Controller, Get, Param, ParseUUIDPipe, Req, Res, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";

import { getAuthContext } from "../auth/auth-context.js";
import { Roles } from "../common/decorators/roles.js";
import { PasswordChangeGuard } from "../common/guards/password-change.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { SessionGuard } from "../common/guards/session.guard.js";
import { ExportsService } from "./exports.service.js";

@ApiTags("exports")
@Controller("workspaces/:workspaceId/documents")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
export class ExportsController {
  public constructor(private readonly exports: ExportsService) {}

  @Get(":documentId/export")
  @Roles("reader")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "exportDocument" })
  @ApiProduces("application/xmind")
  @ApiResponse({
    status: 200,
    description: "A private XMind export stream.",
    content: { "application/xmind": { schema: { type: "string", format: "binary" } } },
  })
  public async export(
    @Param("workspaceId", new ParseUUIDPipe({ version: "7" })) workspaceId: string,
    @Param("documentId", new ParseUUIDPipe({ version: "7" })) documentId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.exports.export(getAuthContext(request), workspaceId, documentId);
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
