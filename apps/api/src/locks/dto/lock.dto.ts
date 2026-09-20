import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class AcquireLockDto {
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public browserEditSessionId!: string;
}

export class LockLeaseDto extends AcquireLockDto {
  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  public token!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  public generation!: number;
}

export class ForceReleaseLockDto {
  @ApiProperty()
  @IsBoolean()
  public confirm!: boolean;
}

export class LockDto {
  @ApiProperty()
  public occupied!: boolean;

  @ApiProperty()
  public generation!: number;

  @ApiPropertyOptional()
  public editorDisplayName?: string;

  @ApiPropertyOptional()
  public heartbeatAt?: string;

  @ApiProperty()
  public ttlSeconds!: number;

  @ApiProperty()
  public expiresAt!: string;
}

export class AcquireLockResponseDto {
  @ApiProperty({ type: LockDto })
  public lock!: LockDto & { token: string };
}

export class LockResponseDto {
  @ApiProperty({ type: LockDto })
  public lock!: LockDto;
}

export class HeartbeatLockResponseDto {
  @ApiProperty()
  public generation!: number;

  @ApiProperty()
  public ttlSeconds!: number;

  @ApiProperty()
  public expiresAt!: string;
}
