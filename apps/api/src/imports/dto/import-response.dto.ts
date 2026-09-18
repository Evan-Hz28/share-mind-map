import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ImportJobResponseDto {
  @ApiProperty() public id!: string;
  @ApiProperty() public clientFileName!: string;
  @ApiProperty() public targetName!: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) public targetFolderId!:
    string | null;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) public documentId!:
    string | null;
  @ApiProperty() public phase!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) public errorCode!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) public errorMessage!: string | null;
}

export class ImportBatchResponseDto {
  @ApiProperty() public id!: string;
  @ApiProperty() public status!: string;
  @ApiProperty() public totalJobs!: number;
  @ApiProperty() public uploadedJobs!: number;
  @ApiProperty() public succeededJobs!: number;
  @ApiProperty() public failedJobs!: number;
  @ApiProperty() public cancelledJobs!: number;
  @ApiProperty() public expectedBytes!: number;
  @ApiProperty({ type: [ImportJobResponseDto] }) public jobs!: ImportJobResponseDto[];
}
