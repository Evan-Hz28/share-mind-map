import { ApiProperty } from "@nestjs/swagger";

export class StorageUsageDto {
  @ApiProperty({ format: "uuid" })
  public workspaceId!: string;

  @ApiProperty()
  public folderCount!: number;

  @ApiProperty()
  public documentCount!: number;

  @ApiProperty()
  public knownObjectBytes!: number;

  @ApiProperty()
  public quotaBytes!: number;

  @ApiProperty()
  public usagePercent!: number;

  @ApiProperty({ enum: ["normal", "warning", "critical", "exceeded"] })
  public threshold!: "normal" | "warning" | "critical" | "exceeded";

  @ApiProperty({ enum: ["pending"] })
  public reconciliationStatus!: "pending";
}
