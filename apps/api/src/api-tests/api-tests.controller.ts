import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
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
  ApiTestBatchResponseDto,
  ApiTestCaseListResponseDto,
  ApiTestCollectionDetailResponseDto,
  ApiTestCollectionExecutionListResponseDto,
  ApiTestCollectionListResponseDto,
  ApiTestEnvironmentListResponseDto,
  CreateApiTestCollectionDto,
  RunApiTestCollectionDto,
  SetApiTestCollectionItemsDto,
  UpdateApiTestCollectionDto,
  ApiTestRunCreateResponseDto,
  ApiTestRunDetailResponseDto,
  ApiTestRunListResponseDto,
  ApiTestRunResponseDto,
  ApiTestScheduleListResponseDto,
  ApiTestSchedulePreviewResponseDto,
  ApiTestScheduleResponseDto,
  ApiTestSuiteListResponseDto,
  ApiTestSyncListResponseDto,
  ApiTestSyncResponseDto,
  CreateApiTestRunDto,
  CreateApiTestScheduleDto,
  PreviewApiTestScheduleDto,
  SetApiTestScheduleEnabledDto,
  UpdateApiTestScheduleDto,
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

  @Get("cases")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listApiTestCases" })
  @ApiQuery({ name: "suiteId", required: true, type: String, format: "uuid" })
  @ApiResponse({ status: 200, type: ApiTestCaseListResponseDto })
  public async listCases(
    @Query("suiteId", new ParseUUIDPipe({ version: "7" })) suiteId: string,
  ): Promise<ApiTestCaseListResponseDto> {
    return { cases: await this.apiTests.listCases(suiteId) };
  }

  @Get("collections")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listApiTestCollections" })
  @ApiResponse({ status: 200, type: ApiTestCollectionListResponseDto })
  public async listCollections(): Promise<ApiTestCollectionListResponseDto> {
    return { collections: await this.apiTests.listCollections() };
  }

  @Post("collections")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "createApiTestCollection" })
  @ApiResponse({ status: 201, type: ApiTestCollectionDetailResponseDto })
  public createCollection(
    @Body() input: CreateApiTestCollectionDto,
    @Req() request: Request,
  ): Promise<ApiTestCollectionDetailResponseDto> {
    return this.apiTests.createCollection(getAuthContext(request), {
      name: input.name,
      description: input.description ?? "",
      items: input.items,
    });
  }

  @Get("collections/:collectionId")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "getApiTestCollection" })
  @ApiResponse({ status: 200, type: ApiTestCollectionDetailResponseDto })
  public getCollection(
    @Param("collectionId", new ParseUUIDPipe({ version: "7" })) collectionId: string,
  ): Promise<ApiTestCollectionDetailResponseDto> {
    return this.apiTests.getCollection(collectionId);
  }

  @Patch("collections/:collectionId")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "updateApiTestCollection" })
  @ApiResponse({ status: 200, type: ApiTestCollectionDetailResponseDto })
  public updateCollection(
    @Param("collectionId", new ParseUUIDPipe({ version: "7" })) collectionId: string,
    @Body() input: UpdateApiTestCollectionDto,
  ): Promise<ApiTestCollectionDetailResponseDto> {
    return this.apiTests.updateCollection(collectionId, {
      name: input.name,
      description: input.description ?? "",
    });
  }

  @Delete("collections/:collectionId")
  @HttpCode(204)
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "deleteApiTestCollection" })
  @ApiResponse({ status: 204 })
  public async deleteCollection(
    @Param("collectionId", new ParseUUIDPipe({ version: "7" })) collectionId: string,
  ): Promise<void> {
    await this.apiTests.deleteCollection(collectionId);
  }

  @Put("collections/:collectionId/items")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "setApiTestCollectionItems" })
  @ApiResponse({ status: 200, type: ApiTestCollectionDetailResponseDto })
  public setCollectionItems(
    @Param("collectionId", new ParseUUIDPipe({ version: "7" })) collectionId: string,
    @Body() input: SetApiTestCollectionItemsDto,
  ): Promise<ApiTestCollectionDetailResponseDto> {
    return this.apiTests.setCollectionItems(collectionId, input.items);
  }

  @Post("collections/:collectionId/runs")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "runApiTestCollection" })
  @ApiResponse({ status: 201, type: ApiTestRunCreateResponseDto })
  public runCollection(
    @Param("collectionId", new ParseUUIDPipe({ version: "7" })) collectionId: string,
    @Body() input: RunApiTestCollectionDto,
    @Req() request: Request,
  ): Promise<ApiTestRunCreateResponseDto> {
    return this.apiTests.runCollection(getAuthContext(request), collectionId, input.environmentId);
  }

  @Get("collections/:collectionId/executions")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listApiTestCollectionExecutions" })
  @ApiResponse({ status: 200, type: ApiTestCollectionExecutionListResponseDto })
  public async listCollectionExecutions(
    @Param("collectionId", new ParseUUIDPipe({ version: "7" })) collectionId: string,
    @Query("limit") limit?: string,
  ): Promise<ApiTestCollectionExecutionListResponseDto> {
    const parsed = limit === undefined ? 20 : Number.parseInt(limit, 10);
    return {
      executions: await this.apiTests.listCollectionExecutions(
        collectionId,
        Number.isFinite(parsed) ? parsed : 20,
      ),
    };
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
  @ApiResponse({ status: 201, type: ApiTestRunCreateResponseDto })
  public createRuns(
    @Body() input: CreateApiTestRunDto,
    @Req() request: Request,
  ): Promise<ApiTestRunCreateResponseDto> {
    return this.apiTests.createRuns(getAuthContext(request), input);
  }

  @Post("run-items/:itemId/rerun")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "rerunApiTestRunItem" })
  @ApiResponse({ status: 201, type: ApiTestRunCreateResponseDto })
  public rerunRunItem(
    @Param("itemId", new ParseUUIDPipe({ version: "7" })) itemId: string,
    @Req() request: Request,
  ): Promise<ApiTestRunCreateResponseDto> {
    return this.apiTests.rerunRunItem(getAuthContext(request), itemId);
  }

  @Get("batches/:batchId")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "getApiTestBatch" })
  @ApiResponse({ status: 200, type: ApiTestBatchResponseDto })
  public getBatch(
    @Param("batchId", new ParseUUIDPipe({ version: "7" })) batchId: string,
  ): Promise<ApiTestBatchResponseDto> {
    return this.apiTests.getBatch(batchId);
  }

  @Get("runs")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listApiTestRuns" })
  @ApiQuery({ name: "suiteId", required: false, type: String, format: "uuid" })
  @ApiQuery({ name: "batchId", required: false, type: String, format: "uuid" })
  @ApiResponse({ status: 200, type: ApiTestRunListResponseDto })
  public async listRuns(
    @Query("limit") limit?: string,
    @Query("suiteId", new ParseUUIDPipe({ version: "7", optional: true }))
    suiteId?: string,
    @Query("batchId", new ParseUUIDPipe({ version: "7", optional: true }))
    batchId?: string,
  ): Promise<ApiTestRunListResponseDto> {
    const parsed = limit === undefined ? 20 : Number.parseInt(limit, 10);
    return {
      runs: await this.apiTests.listRuns(Number.isFinite(parsed) ? parsed : 20, {
        ...(suiteId === undefined ? {} : { suiteId }),
        ...(batchId === undefined ? {} : { batchId }),
      }),
    };
  }

  @Post("batches/:batchId/cancel")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "cancelApiTestBatch" })
  @ApiResponse({ status: 201, type: ApiTestBatchResponseDto })
  public cancelBatch(
    @Param("batchId", new ParseUUIDPipe({ version: "7" })) batchId: string,
  ): Promise<ApiTestBatchResponseDto> {
    return this.apiTests.cancelBatch(batchId);
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

  @Get("schedules")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "listApiTestSchedules" })
  @ApiResponse({ status: 200, type: ApiTestScheduleListResponseDto })
  public async listSchedules(): Promise<ApiTestScheduleListResponseDto> {
    return { schedules: await this.apiTests.listSchedules() };
  }

  @Post("schedules/preview")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "previewApiTestSchedule" })
  @ApiResponse({ status: 201, type: ApiTestSchedulePreviewResponseDto })
  public previewSchedule(
    @Body() input: PreviewApiTestScheduleDto,
  ): ApiTestSchedulePreviewResponseDto {
    return this.apiTests.previewSchedule(input.cron, input.timezone);
  }

  @Post("schedules")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "createApiTestSchedule" })
  @ApiResponse({ status: 201, type: ApiTestScheduleResponseDto })
  public createSchedule(
    @Body() input: CreateApiTestScheduleDto,
    @Req() request: Request,
  ): Promise<ApiTestScheduleResponseDto> {
    return this.apiTests.createSchedule(getAuthContext(request), {
      name: input.name,
      targetType: input.targetType,
      targetId: input.targetId,
      environmentId: input.environmentId,
      cron: input.cron,
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      ...(input.syncBeforeRun === undefined ? {} : { syncBeforeRun: input.syncBeforeRun }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    });
  }

  @Get("schedules/:scheduleId")
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ operationId: "getApiTestSchedule" })
  @ApiResponse({ status: 200, type: ApiTestScheduleResponseDto })
  public getSchedule(
    @Param("scheduleId", new ParseUUIDPipe({ version: "7" })) scheduleId: string,
  ): Promise<ApiTestScheduleResponseDto> {
    return this.apiTests.getSchedule(scheduleId);
  }

  @Patch("schedules/:scheduleId")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "updateApiTestSchedule" })
  @ApiResponse({ status: 200, type: ApiTestScheduleResponseDto })
  public updateSchedule(
    @Param("scheduleId", new ParseUUIDPipe({ version: "7" })) scheduleId: string,
    @Body() input: UpdateApiTestScheduleDto,
  ): Promise<ApiTestScheduleResponseDto> {
    return this.apiTests.updateSchedule(scheduleId, {
      name: input.name,
      targetType: input.targetType,
      targetId: input.targetId,
      environmentId: input.environmentId,
      cron: input.cron,
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      ...(input.syncBeforeRun === undefined ? {} : { syncBeforeRun: input.syncBeforeRun }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    });
  }

  @Patch("schedules/:scheduleId/enabled")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "setApiTestScheduleEnabled" })
  @ApiResponse({ status: 200, type: ApiTestScheduleResponseDto })
  public setScheduleEnabled(
    @Param("scheduleId", new ParseUUIDPipe({ version: "7" })) scheduleId: string,
    @Body() input: SetApiTestScheduleEnabledDto,
  ): Promise<ApiTestScheduleResponseDto> {
    return this.apiTests.setScheduleEnabled(scheduleId, input.enabled);
  }

  @Delete("schedules/:scheduleId")
  @HttpCode(204)
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "deleteApiTestSchedule" })
  @ApiResponse({ status: 204 })
  public async deleteSchedule(
    @Param("scheduleId", new ParseUUIDPipe({ version: "7" })) scheduleId: string,
  ): Promise<void> {
    await this.apiTests.deleteSchedule(scheduleId);
  }

  @Post("schedules/:scheduleId/run")
  @ApiSecurity({ sessionCookie: [], csrfToken: [] })
  @ApiOperation({ operationId: "runApiTestScheduleNow" })
  @ApiResponse({ status: 201, type: ApiTestRunCreateResponseDto })
  public runScheduleNow(
    @Param("scheduleId", new ParseUUIDPipe({ version: "7" })) scheduleId: string,
    @Req() request: Request,
  ): Promise<ApiTestRunCreateResponseDto> {
    return this.apiTests.runScheduleNow(getAuthContext(request), scheduleId);
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
