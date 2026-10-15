import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class ChangePasswordDto {
  @ApiProperty({ format: "password", writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  public currentPassword!: string;

  @ApiProperty({ format: "password", minLength: 6, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  public newPassword!: string;
}
