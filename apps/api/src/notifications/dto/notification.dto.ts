import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class NotificationDto {
  @ApiProperty({ format: "uuid" })
  public id!: string;

  @ApiProperty()
  public notificationType!: string;

  @ApiProperty()
  public title!: string;

  @ApiProperty()
  public body!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  public targetType!: string | null;

  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true })
  public targetId!: string | null;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  public readAt!: string | null;

  @ApiProperty({ format: "date-time" })
  public createdAt!: string;
}

export class NotificationListQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  public limit = 50;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  public cursor?: string;
}

export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationDto] })
  public notifications!: NotificationDto[];

  @ApiProperty()
  public unreadCount!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  public nextCursor!: string | null;
}

export class NotificationReadAllResponseDto {
  @ApiProperty()
  public markedCount!: number;
}
