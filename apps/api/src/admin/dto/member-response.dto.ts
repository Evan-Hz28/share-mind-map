import { ApiProperty } from "@nestjs/swagger";

import type { SessionRole } from "../../auth/session/session.types.js";

export class MemberResponseDto {
  @ApiProperty({ format: "uuid" })
  public id!: string;

  @ApiProperty({ format: "uuid" })
  public userId!: string;

  @ApiProperty()
  public displayName!: string;

  @ApiProperty()
  public loginName!: string;

  @ApiProperty({ enum: ["reader", "editor", "admin"] })
  public role!: SessionRole;

  @ApiProperty({ enum: ["active", "disabled"] })
  public accountStatus!: "active" | "disabled";

  @ApiProperty()
  public mustChangePassword!: boolean;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  public lastLoginAt!: string | null;
}

export class MemberListResponseDto {
  @ApiProperty({ type: [MemberResponseDto] })
  public members!: MemberResponseDto[];
}

export class CreatedMemberResponseDto {
  @ApiProperty({ type: MemberResponseDto })
  public member!: MemberResponseDto;

  @ApiProperty({ readOnly: true })
  public temporaryPassword!: string;
}

export class TemporaryPasswordResponseDto {
  @ApiProperty({ readOnly: true })
  public temporaryPassword!: string;
}
