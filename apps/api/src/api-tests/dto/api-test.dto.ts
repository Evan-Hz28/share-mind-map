import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from "class-validator";

export class CreateApiTestRunDto {
  /** 可多选；后端按数组顺序建 run，worker 单并发天然串行执行。 */
  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID("7", { each: true })
  public suiteIds!: string[];

  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID("7")
  public environmentId!: string;
}

export class CreateApiTestCollectionDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  public name!: string;

  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;

  /** 空数组合法：先建空集合，之后在详情页里添加套件。 */
  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID("7", { each: true })
  public suiteIds!: string[];
}

export class UpdateApiTestCollectionDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  public name!: string;

  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;
}

export class SetApiTestCollectionSuitesDto {
  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID("7", { each: true })
  public suiteIds!: string[];
}

export class RunApiTestCollectionDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID("7")
  public environmentId!: string;
}

export class CreateApiTestScheduleDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  public name!: string;

  @ApiProperty({ type: String, enum: ["suite", "collection"] })
  @IsIn(["suite", "collection"])
  public targetType!: "suite" | "collection";

  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID("7")
  public targetId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID("7")
  public environmentId!: string;

  /** 五段 cron，最小间隔 1 分钟；精确定义由 service 用 cron-parser 校验。 */
  @ApiProperty({ type: String, example: "0 2 * * *" })
  @IsString()
  @Length(1, 100)
  public cron!: string;

  @ApiPropertyOptional({ type: String, default: "Asia/Shanghai" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  public timezone?: string;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  public syncBeforeRun?: boolean;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsOptional()
  @IsBoolean()
  public enabled?: boolean;
}

export class UpdateApiTestScheduleDto extends CreateApiTestScheduleDto {}

export class SetApiTestScheduleEnabledDto {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  public enabled!: boolean;
}

export class PreviewApiTestScheduleDto {
  @ApiProperty({ type: String, example: "0 2 * * *" })
  @IsString()
  @Length(1, 100)
  public cron!: string;

  @ApiPropertyOptional({ type: String, default: "Asia/Shanghai" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  public timezone?: string;
}

export class ApiTestScheduleResponseDto {
  @ApiProperty() public id!: string;
  @ApiProperty() public name!: string;
  @ApiProperty() public targetType!: string;
  @ApiProperty() public targetId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) public targetName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) public targetPath!: string | null;
  @ApiProperty() public environmentId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) public environmentName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) public environmentKey!: string | null;
  @ApiProperty() public cron!: string;
  @ApiProperty() public timezone!: string;
  @ApiProperty() public syncBeforeRun!: boolean;
  @ApiProperty() public enabled!: boolean;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public nextRunAt!: string | null;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  public lastBatchId!: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public lastRunAt!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) public lastRunStatus!: string | null;
  @ApiProperty() public lastTotalCount!: number;
  @ApiProperty() public lastPassedCount!: number;
  @ApiProperty() public lastFailedCount!: number;
  @ApiProperty() public lastSkippedCount!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) public lastError!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) public createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) public updatedAt!: string;
}

export class ApiTestScheduleListResponseDto {
  @ApiProperty({ type: [ApiTestScheduleResponseDto] })
  public schedules!: ApiTestScheduleResponseDto[];
}

export class ApiTestSchedulePreviewResponseDto {
  @ApiProperty({ type: [String], description: "接下来三次触发时间（ISO 8601）" })
  public nextRuns!: string[];
}

export class ApiTestCollectionResponseDto {
  @ApiProperty() public id!: string;
  @ApiProperty() public name!: string;
  @ApiProperty() public description!: string;
  @ApiProperty() public suiteCount!: number;
  @ApiProperty() public caseCount!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) public lastRunStatus!: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public lastRunAt!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) public createdAt!: string;
  @ApiProperty({ type: String, format: "date-time" }) public updatedAt!: string;
}

export class ApiTestCollectionSuiteResponseDto {
  @ApiProperty() public suiteId!: string;
  @ApiProperty() public key!: string;
  @ApiProperty() public name!: string;
  @ApiProperty() public path!: string;
  @ApiProperty() public enabled!: boolean;
  @ApiProperty() public position!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) public lastRunId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) public lastRunStatus!: string | null;
  @ApiProperty() public totalCount!: number;
  @ApiProperty() public passedCount!: number;
  @ApiProperty() public failedCount!: number;
  @ApiProperty() public skippedCount!: number;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public lastRunAt!: string | null;
}

export class ApiTestCollectionDetailResponseDto extends ApiTestCollectionResponseDto {
  @ApiProperty({ type: [ApiTestCollectionSuiteResponseDto] })
  public suites!: ApiTestCollectionSuiteResponseDto[];
}

export class ApiTestCollectionListResponseDto {
  @ApiProperty({ type: [ApiTestCollectionResponseDto] })
  public collections!: ApiTestCollectionResponseDto[];
}

export class ApiTestCollectionExecutionResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) public batchId!: string;
  @ApiProperty() public status!: string;
  @ApiProperty() public suiteCount!: number;
  @ApiProperty() public totalCount!: number;
  @ApiProperty() public passedCount!: number;
  @ApiProperty() public failedCount!: number;
  @ApiProperty() public skippedCount!: number;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public startedAt!: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public finishedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) public createdAt!: string;
}

export class ApiTestCollectionExecutionListResponseDto {
  @ApiProperty({ type: [ApiTestCollectionExecutionResponseDto] })
  public executions!: ApiTestCollectionExecutionResponseDto[];
}

export class ApiTestSuiteResponseDto {
  @ApiProperty() public id!: string;
  @ApiProperty() public key!: string;
  @ApiProperty() public name!: string;
  @ApiProperty() public path!: string;
}

export class ApiTestEnvironmentResponseDto {
  @ApiProperty() public id!: string;
  @ApiProperty() public key!: string;
  @ApiProperty() public name!: string;
  @ApiProperty() public baseUrl!: string;
}

export class ApiTestSuiteListResponseDto {
  @ApiProperty({ type: [ApiTestSuiteResponseDto] }) public suites!: ApiTestSuiteResponseDto[];
}

export class ApiTestEnvironmentListResponseDto {
  @ApiProperty({ type: [ApiTestEnvironmentResponseDto] })
  public environments!: ApiTestEnvironmentResponseDto[];
}

export class ApiTestRunItemResponseDto {
  @ApiProperty() public id!: string;
  @ApiProperty() public nodeId!: string;
  @ApiProperty() public caseName!: string;
  @ApiProperty() public ordinal!: number;
  @ApiProperty() public status!: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) public durationMs!: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) public failure!: string | null;
  @ApiPropertyOptional({ type: Object, nullable: true }) public request!: unknown;
  @ApiPropertyOptional({ type: Object, nullable: true }) public response!: unknown;
}

export class ApiTestRunResponseDto {
  @ApiProperty() public id!: string;
  @ApiProperty() public suiteId!: string;
  @ApiProperty() public suiteKey!: string;
  @ApiProperty() public suiteName!: string;
  @ApiProperty() public environmentId!: string;
  @ApiProperty() public environmentKey!: string;
  @ApiProperty() public environmentName!: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  public batchId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) public repoCommit!: string | null;
  @ApiProperty() public status!: string;
  @ApiProperty() public cancelRequested!: boolean;
  @ApiProperty() public totalCount!: number;
  @ApiProperty() public passedCount!: number;
  @ApiProperty() public failedCount!: number;
  @ApiProperty() public skippedCount!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) public errorMessage!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) public createdAt!: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public startedAt!: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public finishedAt!: string | null;
}

export class ApiTestRunDetailResponseDto extends ApiTestRunResponseDto {
  @ApiProperty({ type: [ApiTestRunItemResponseDto] })
  public items!: ApiTestRunItemResponseDto[];
}

export class ApiTestRunListResponseDto {
  @ApiProperty({ type: [ApiTestRunResponseDto] }) public runs!: ApiTestRunResponseDto[];
}

/** 一次多选执行返回一个批次 id，前端据此跳批次报告页。 */
export class ApiTestRunCreateResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) public batchId!: string;
  @ApiProperty({ type: [ApiTestRunResponseDto] }) public runs!: ApiTestRunResponseDto[];
}

export class ApiTestBatchTotalsDto {
  @ApiProperty() public suiteCount!: number;
  @ApiProperty() public totalCount!: number;
  @ApiProperty() public passedCount!: number;
  @ApiProperty() public failedCount!: number;
  @ApiProperty() public skippedCount!: number;
}

/**
 * 批次没有独立表，状态和统计都从子 run 派生：
 * 还有排队/执行中的就是 running，否则任一套件失败即 failed。
 */
export class ApiTestBatchResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) public batchId!: string;
  @ApiProperty() public status!: string;
  @ApiProperty() public environmentId!: string;
  @ApiProperty() public environmentName!: string;
  @ApiProperty({ type: ApiTestBatchTotalsDto }) public totals!: ApiTestBatchTotalsDto;
  @ApiProperty({ type: [ApiTestRunResponseDto] }) public runs!: ApiTestRunResponseDto[];
}

export class ApiTestSyncResponseDto {
  @ApiProperty() public id!: string;
  @ApiProperty() public branch!: string;
  @ApiProperty() public status!: string;
  @ApiProperty() public trigger!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) public requestedBy!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) public commitSha!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) public previousSha!: string | null;
  @ApiProperty() public changedFiles!: number;
  @ApiProperty() public suitesAdded!: number;
  @ApiProperty() public suitesRemoved!: number;
  @ApiProperty() public requirementsChanged!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) public message!: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public startedAt!: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public finishedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) public createdAt!: string;
}

export class ApiTestSyncListResponseDto {
  @ApiProperty({ type: [ApiTestSyncResponseDto] })
  public syncs!: ApiTestSyncResponseDto[];
}
