import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
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
import { ApiTestsService } from "./api-tests.service.js";
import {
  ApiTestEnvironmentListResponseDto,
  ApiTestRunDetailResponseDto,
  ApiTestRunListResponseDto,
  ApiTestRunResponseDto,
  ApiTestSuiteListResponseDto,
  ApiTestSyncListResponseDto,
  ApiTestSyncResponseDto,
  CreateApiTestRunDto,
} from "./dto/api-test.dto.js";

@ApiTags("api-tests")
@Controller("api-tests")
@UseGuards(SessionGuard, PasswordChangeGuard, RolesGuard)
@Roles("admin")
export class ApiTestsController {
  public constructor(private readonly apiTests: ApiTestsService) {}

  @Get("suites")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listApiTestSuites" })
  @ApiResponse({ status: 200, type: ApiTestSuiteListResponseDto })
  public async listSuites(): Promise<ApiTestSuiteListResponseDto> {
    return { suites: await this.apiTests.listSuites() };
  }

  @Get("environments")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listApiTestEnvironments" })
  @ApiResponse({ status: 200, type: ApiTestEnvironmentListResponseDto })
  public async listEnvironments(): Promise<ApiTestEnvironmentListResponseDto> {
    return { environments: await this.apiTests.listEnvironments() };
  }

  @Post("runs")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "createApiTestRuns" })
  @ApiResponse({ status: 201, type: ApiTestRunListResponseDto })
  public async createRuns(
    @Body() input: CreateApiTestRunDto,
    @Req() request: Request,
  ): Promise<ApiTestRunListResponseDto> {
    return { runs: await this.apiTests.createRuns(getAuthContext(request), input) };
  }

  @Get("runs")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listApiTestRuns" })
  @ApiResponse({ status: 200, type: ApiTestRunListResponseDto })
  public async listRuns(
    @Query("limit") limit?: string,
  ): Promise<ApiTestRunListResponseDto> {
    const parsed = limit === undefined ? 20 : Number.parseInt(limit, 10);
    return { runs: await this.apiTests.listRuns(Number.isFinite(parsed) ? parsed : 20) };
  }

  @Get("runs/:runId")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "getApiTestRun" })
  @ApiResponse({ status: 200, type: ApiTestRunDetailResponseDto })
  public getRun(
    @Param("runId", new ParseUUIDPipe({ version: "7" })) runId: string,
  ): Promise<ApiTestRunDetailResponseDto> {
    return this.apiTests.getRun(runId);
  }

  @Post("sync")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "syncApiTestRepository" })
  @ApiResponse({ status: 201, type: ApiTestSyncResponseDto })
  public syncRepository(@Req() request: Request): Promise<ApiTestSyncResponseDto> {
    return this.apiTests.syncRepository(getAuthContext(request).session.userId);
  }

  @Get("syncs")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listApiTestSyncs" })
  @ApiResponse({ status: 200, type: ApiTestSyncListResponseDto })
  public async listSyncs(@Query("limit") limit?: string): Promise<ApiTestSyncListResponseDto> {
    const parsed = limit === undefined ? 10 : Number.parseInt(limit, 10);
    return { syncs: await this.apiTests.listSyncs(Number.isFinite(parsed) ? parsed : 10) };
  }

  @Post("runs/:runId/cancel")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "cancelApiTestRun" })
  @ApiResponse({ status: 200, type: ApiTestRunResponseDto })
  public cancelRun(
    @Param("runId", new ParseUUIDPipe({ version: "7" })) runId: string,
  ): Promise<ApiTestRunResponseDto> {
    return this.apiTests.cancelRun(runId);
  }
}
