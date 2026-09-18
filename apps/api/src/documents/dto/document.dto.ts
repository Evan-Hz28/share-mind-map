import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class DocumentDto {
  @ApiProperty({ format: "uuid" })
  public id!: string;

  @ApiProperty({ format: "uuid" })
  public workspaceId!: string;

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  public folderId!: string | null;

  @ApiProperty()
  public name!: string;

  @ApiProperty()
  public currentVersion!: number;

  @ApiProperty()
  public schemaVersion!: number;

  @ApiProperty({ enum: ["full", "partial", "unsupported_online"] })
  public compatibilityStatus!: "full" | "partial" | "unsupported_online";

  @ApiProperty()
  public nodeCount!: number;

  @ApiProperty()
  public imageBytes!: number;

  @ApiProperty({ format: "date-time" })
  public createdAt!: string;

  @ApiProperty({ format: "date-time" })
  public updatedAt!: string;
}

export class DocumentListResponseDto {
  @ApiProperty({ type: [DocumentDto] })
  public documents!: DocumentDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  public nextCursor!: string | null;
}

export class DocumentResponseDto {
  @ApiProperty({ type: DocumentDto })
  public document!: DocumentDto;
}

export class DocumentDetailDto extends DocumentDto {
  @ApiProperty({ type: Object })
  public snapshot!: Record<string, unknown>;
}

export class DocumentDetailResponseDto {
  @ApiProperty({ type: DocumentDetailDto })
  public document!: DocumentDetailDto;
}
