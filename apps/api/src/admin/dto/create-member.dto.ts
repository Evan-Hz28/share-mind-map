import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class CreateMemberDto {
  @ApiProperty({ example: "reader.one", minLength: 3, maxLength: 64 })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,64}$/)
  public loginName!: string;

  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  public displayName!: string;
}
