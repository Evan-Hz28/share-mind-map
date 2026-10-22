import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class FolderNameDto {
  @ApiProperty({ minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  public name!: string;
}

export class CreateFolderDto extends FolderNameDto {
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("7")
  public parentId?: string | null;
}

export class MoveFolderDto {
  @ApiProperty({ type: String, format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("7")
  public parentId!: string | null;
}

export class ReorderFoldersDto {
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("7")
  public parentId?: string | null;

  @ApiProperty({ type: [String], format: "uuid", maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID("7", { each: true })
  public folderIds!: string[];
}

export class DeleteFolderQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  public expectedDocumentCount?: number;
}
