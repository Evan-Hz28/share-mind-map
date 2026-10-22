import { ApiProperty } from "@nestjs/swagger";

export class FolderDto {
  @ApiProperty({ format: "uuid" })
  public id!: string;

  @ApiProperty({ format: "uuid" })
  public workspaceId!: string;

  @ApiProperty({ type: String, format: "uuid", nullable: true })
  public parentId!: string | null;

  @ApiProperty()
  public name!: string;

  @ApiProperty({ format: "date-time" })
  public createdAt!: string;

  @ApiProperty({ format: "date-time" })
  public updatedAt!: string;
}

export class FolderListResponseDto {
  @ApiProperty({ type: [FolderDto] })
  public folders!: FolderDto[];
}

export class FolderResponseDto {
  @ApiProperty({ type: FolderDto })
  public folder!: FolderDto;
}

export class FolderDeleteCheckResponseDto {
  @ApiProperty({ type: FolderDto })
  public folder!: FolderDto;

  @ApiProperty()
  public documentCount!: number;

  @ApiProperty()
  public descendantFolderCount!: number;

  @ApiProperty()
  public canDelete!: boolean;
}
