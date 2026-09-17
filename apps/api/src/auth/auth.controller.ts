import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";

import { getAuthContext } from "./auth-context.js";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "./cookies/session-cookie.js";
import { ChangePasswordDto } from "./dto/change-password.dto.js";
import { LoginDto } from "./dto/login.dto.js";
import {
  CsrfResponseDto,
  LoginResponseDto,
  SessionResponseDto,
} from "./dto/session-response.dto.js";
import { AuthService } from "./auth.service.js";
import { PasswordChangeGuard } from "../common/guards/password-change.guard.js";
import { SessionGuard } from "../common/guards/session.guard.js";
import { APP_CONFIG } from "../platform/config/config.module.js";
import type { AppConfig } from "../platform/config/app-config.js";
import { getRequestId } from "../platform/http/request-id.middleware.js";

@ApiTags("authentication")
@Controller()
export class AuthController {
  public constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("auth/login")
  @ApiOperation({ operationId: "authLogin" })
  @ApiResponse({ status: 201, type: LoginResponseDto })
  public async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.auth.login(input, {
      sourceAddress: request.ip ?? request.socket.remoteAddress ?? "unknown",
      requestId: getRequestId(request),
    });
    setSessionCookie(response, result.token, this.config);
    return result.response;
  }

  @Get("auth/csrf")
  @UseGuards(SessionGuard, PasswordChangeGuard)
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "authCsrf" })
  @ApiResponse({ status: 200, type: CsrfResponseDto })
  public async csrf(@Req() request: Request): Promise<CsrfResponseDto> {
    return { csrfToken: await this.auth.rotateCsrf(getAuthContext(request)) };
  }

  @Get("me")
  @UseGuards(SessionGuard, PasswordChangeGuard)
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "getMe" })
  @ApiResponse({ status: 200, type: SessionResponseDto })
  public me(@Req() request: Request): Promise<SessionResponseDto> {
    return this.auth.me(getAuthContext(request));
  }

  @Put("auth/password")
  @HttpCode(204)
  @UseGuards(SessionGuard, PasswordChangeGuard)
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "authChangePassword" })
  public async changePassword(
    @Body() input: ChangePasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.changePassword(getAuthContext(request), input, getRequestId(request));
    clearSessionCookie(response, this.config);
  }

  @Post("auth/logout")
  @HttpCode(204)
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "authLogout" })
  public async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(
      readSessionCookie(request.headers.cookie),
      request.header("x-csrf-token"),
      getRequestId(request),
    );
    clearSessionCookie(response, this.config);
  }
}
