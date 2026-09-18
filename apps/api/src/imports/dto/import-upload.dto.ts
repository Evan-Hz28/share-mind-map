import { ApiProperty } from "@nestjs/swagger";

export class ImportUploadDto {
  @ApiProperty({ type: "string", format: "binary" })
  public file!: string;
}
