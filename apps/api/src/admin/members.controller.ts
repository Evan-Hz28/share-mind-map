import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { ChangeAccountStatusDto } from "./dto/change-account-status.dto.js";
import { CreateMemberDto } from "./dto/create-member.dto.js";
import {
  CreatedMemberResponseDto,
  MemberListResponseDto,
  MemberResponseDto,
  TemporaryPasswordResponseDto,
} from "./dto/member-response.dto.js";
import { MembersService } from "./members.service.js";

@ApiTags("administration")
@Controller("admin/members")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
@Roles("admin")
export class MembersController {
  public constructor(private readonly members: MembersService) {}

  @Get()
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "adminListMembers" })
  @ApiResponse({ status: 200, type: MemberListResponseDto })
  public async list(@Req() request: Request): Promise<MemberListResponseDto> {
    return { members: await this.members.list(getAuthContext(request)) };
  }

  @Post()
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "adminCreateMember" })
  @ApiResponse({ status: 201, type: CreatedMemberResponseDto })
  public create(
    @Body() input: CreateMemberDto,
    @Req() request: Request,
  ): Promise<CreatedMemberResponseDto> {
    return this.members.create(getAuthContext(request), input, getRequestId(request));
  }

  @Post(":id/password/reset")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "adminResetMemberPassword" })
  @ApiResponse({ status: 201, type: TemporaryPasswordResponseDto })
  public async resetPassword(
    @Param("id", new ParseUUIDPipe({ version: "7" })) id: string,
    @Req() request: Request,
  ): Promise<TemporaryPasswordResponseDto> {
    return {
      temporaryPassword: await this.members.resetPassword(
        getAuthContext(request),
        id,
        getRequestId(request),
      ),
    };
  }

  @Patch(":id/account-status")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "adminChangeAccountStatus" })
  @ApiResponse({ status: 200, type: MemberResponseDto })
  public changeStatus(
    @Param("id", new ParseUUIDPipe({ version: "7" })) id: string,
    @Body() input: ChangeAccountStatusDto,
    @Req() request: Request,
  ): Promise<MemberResponseDto> {
    return this.members.changeStatus(getAuthContext(request), id, input, getRequestId(request));
  }

  @Post(":id/sessions/revoke")
  @HttpCode(204)
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "adminRevokeMemberSessions" })
  public revokeSessions(
    @Param("id", new ParseUUIDPipe({ version: "7" })) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.members.revokeSessions(getAuthContext(request), id, getRequestId(request));
  }
}
