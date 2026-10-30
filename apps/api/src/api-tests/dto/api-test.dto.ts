import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";

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
