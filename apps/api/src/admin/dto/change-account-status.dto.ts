import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

export class ChangeAccountStatusDto {
  @ApiProperty({ enum: ["active", "disabled"] })
  @IsIn(["active", "disabled"])
  public status!: "active" | "disabled";
}
