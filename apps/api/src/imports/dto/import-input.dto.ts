import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class ImportFilePreflightDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  public clientFileName!: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public targetName!: string;

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("7")
  public targetFolderId?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 20_971_520 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20_971_520)
  @Type(() => Number)
  public expectedBytes?: number;
}

export class CreateImportBatchDto {
  @ApiProperty({ type: [ImportFilePreflightDto], minItems: 1, maxItems: 50 })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportFilePreflightDto)
  public files!: ImportFilePreflightDto[];
}
