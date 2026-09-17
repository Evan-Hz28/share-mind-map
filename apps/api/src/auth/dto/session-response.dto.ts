import { ApiProperty } from "@nestjs/swagger";

import type { SessionRole } from "../session/session.types.js";

export class SafeUserDto {
  @ApiProperty({ format: "uuid" })
  public id!: string;

  @ApiProperty()
  public displayName!: string;
}

export class SafeOrganizationDto {
  @ApiProperty({ format: "uuid" })
  public id!: string;

  @ApiProperty()
  public name!: string;
}

export class SafeWorkspaceDto {
  @ApiProperty({ format: "uuid" })
  public id!: string;

  @ApiProperty()
  public name!: string;
}

export class SessionResponseDto {
  @ApiProperty({ type: SafeUserDto })
  public user!: SafeUserDto;

  @ApiProperty({ type: SafeOrganizationDto })
  public organization!: SafeOrganizationDto;

  @ApiProperty({ type: SafeWorkspaceDto })
  public defaultWorkspace!: SafeWorkspaceDto;

  @ApiProperty({ enum: ["reader", "editor", "admin"] })
  public role!: SessionRole;

  @ApiProperty({ type: [String] })
  public effectivePermissions!: string[];

  @ApiProperty()
  public mustChangePassword!: boolean;
}

export class LoginResponseDto extends SessionResponseDto {
  @ApiProperty({ readOnly: true })
  public csrfToken!: string;
}

export class CsrfResponseDto {
  @ApiProperty({ readOnly: true })
  public csrfToken!: string;
}
