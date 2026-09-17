import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "reader.one", minLength: 3, maxLength: 64 })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,64}$/)
  public loginName!: string;

  @ApiProperty({ format: "password", minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  public password!: string;
}
