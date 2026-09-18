import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class DocumentListQueryDto {
  @ApiPropertyOptional({ enum: ["updatedAt", "name"], default: "updatedAt" })
  @IsOptional()
  @IsIn(["updatedAt", "name"])
  public sort: "updatedAt" | "name" = "updatedAt";

  @ApiPropertyOptional({ type: String })
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

export class CreateDocumentDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public name!: string;

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("7")
  public folderId?: string | null;
}

export class UpdateDocumentDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public name?: string;

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("7")
  public folderId?: string | null;
}
