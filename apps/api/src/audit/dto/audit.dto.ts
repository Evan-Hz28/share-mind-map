import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class AuditQueryDto {
  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  public from?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  public to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public action?: string;

  @ApiPropertyOptional({ enum: ["success", "failure", "denied"] })
  @IsOptional()
  @IsIn(["success", "failure", "denied"])
  public result?: "success" | "failure" | "denied";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public cursor?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  public limit = 50;
}

export class AuditLogDto {
  @ApiProperty({ format: "uuid" })
  public id!: string;

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  public actorUserId!: string | null;

  @ApiProperty()
  public action!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  public targetType!: string | null;

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  public targetId!: string | null;

  @ApiProperty({ enum: ["success", "failure", "denied"] })
  public result!: "success" | "failure" | "denied";

  @ApiProperty()
  public metadata!: Record<string, boolean | number | string | null>;

  @ApiProperty({ format: "date-time" })
  public createdAt!: string;
}

export class AuditListResponseDto {
  @ApiProperty({ type: [AuditLogDto] })
  public logs!: AuditLogDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  public nextCursor!: string | null;
}
