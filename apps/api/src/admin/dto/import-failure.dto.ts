import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export class AdminImportFailureQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  public limit = 50;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("7")
  public after?: string;
}

export class AdminImportFailureDto {
  @ApiProperty() public id!: string;
  @ApiProperty() public batchId!: string;
  @ApiProperty() public clientFileName!: string;
  @ApiProperty() public targetName!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) public errorCode!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) public errorMessage!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) public completedAt!: string | null;
}

export class AdminImportFailureListDto {
  @ApiProperty({ type: [AdminImportFailureDto] }) public failures!: AdminImportFailureDto[];
  @ApiPropertyOptional({ type: String, nullable: true }) public nextCursor!: string | null;
}
