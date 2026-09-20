import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsObject,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class SaveSnapshotDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  public baseVersion!: number;

  @ApiProperty({ enum: ["auto", "manual", "restore"] })
  @IsIn(["auto", "manual", "restore"])
  public saveKind!: "auto" | "manual" | "restore";

  @ApiProperty({ type: Object })
  @IsObject()
  public snapshot!: Record<string, unknown>;

  @ApiProperty({ minimum: 0, maximum: 52_428_800 })
  @IsInt()
  @Min(0)
  @Max(52_428_800)
  @Type(() => Number)
  public imageBytes!: number;

  @ApiPropertyOptional({ type: [String], format: "uuid" })
  @IsOptional()
  @IsArray()
  @IsUUID("7", { each: true })
  public assetIds: string[] = [];

  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public browserEditSessionId!: string;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  public token!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  public generation!: number;
}

export class DraftExportDto {
  @ApiProperty({ type: Object })
  @IsObject()
  public snapshot!: Record<string, unknown>;
}
