import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class PermissionRequestDto {
  @ApiProperty({ format: "uuid" })
  public id!: string;

  @ApiProperty({ format: "uuid" })
  public workspaceId!: string;

  @ApiProperty({ format: "uuid" })
  public requesterId!: string;

  @ApiProperty()
  public requesterDisplayName!: string;

  @ApiProperty({ enum: ["pending", "approved", "rejected"] })
  public status!: "pending" | "approved" | "rejected";

  @ApiProperty({ format: "date-time" })
  public requestedAt!: string;

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  public decidedBy!: string | null;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public decidedAt!: string | null;
}

export class PermissionRequestResponseDto {
  @ApiProperty({ type: PermissionRequestDto })
  public request!: PermissionRequestDto;

  @ApiProperty()
  public changed!: boolean;
}

export class PermissionRequestListDto {
  @ApiProperty({ type: [PermissionRequestDto] })
  public requests!: PermissionRequestDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  public nextCursor!: string | null;
}

export class PermissionRequestQueryDto {
  @ApiPropertyOptional({ enum: ["pending", "approved", "rejected"] })
  @IsOptional()
  @IsIn(["pending", "approved", "rejected"])
  public status?: "pending" | "approved" | "rejected";

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

export class RevokeEditingResponseDto {
  @ApiProperty({ format: "uuid" })
  public membershipId!: string;

  @ApiProperty({ format: "uuid" })
  public userId!: string;

  @ApiProperty({ enum: ["reader", "editor", "admin"] })
  public role!: "reader" | "editor" | "admin";

  @ApiProperty()
  public changed!: boolean;
}
