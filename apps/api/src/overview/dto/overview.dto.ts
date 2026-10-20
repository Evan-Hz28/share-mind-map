import { ApiProperty } from "@nestjs/swagger";

export class WorkspaceOverviewDto {
  @ApiProperty({ format: "uuid" })
  public workspaceId!: string;

  @ApiProperty()
  public folderCount!: number;

  @ApiProperty()
  public documentCount!: number;

  @ApiProperty()
  public nodeCount!: number;

  @ApiProperty()
  public activeImportJobs!: number;

  @ApiProperty({ description: "Only counted for administrators; zero for other roles." })
  public pendingEditRequests!: number;
}
