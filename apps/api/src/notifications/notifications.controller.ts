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
  NotificationListQueryDto,
  NotificationListResponseDto,
  NotificationReadAllResponseDto,
  type NotificationDto,
} from "./dto/notification.dto.js";
import { NotificationsService } from "./notifications.service.js";

@ApiTags("notifications")
@Controller("notifications")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
@Roles("reader")
export class NotificationsController {
  public constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listNotifications" })
  @ApiResponse({ status: 200, type: NotificationListResponseDto })
  public list(
    @Query() query: NotificationListQueryDto,
    @Req() request: Request,
  ): Promise<NotificationListResponseDto> {
    return this.notifications.list(getAuthContext(request), query);
  }

  @Post(":notificationId/read")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "readNotification" })
  public read(
    @Param("notificationId", new ParseUUIDPipe({ version: "7" })) notificationId: string,
    @Req() request: Request,
  ): Promise<NotificationDto> {
    return this.notifications.read(getAuthContext(request), notificationId, getRequestId(request));
  }

  @Post("read-all")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "readAllNotifications" })
  @ApiResponse({ status: 201, type: NotificationReadAllResponseDto })
  public readAll(@Req() request: Request): Promise<NotificationReadAllResponseDto> {
    return this.notifications.readAll(getAuthContext(request), getRequestId(request));
  }
}
