import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RevokeDeviceTokenDto {
  @ApiPropertyOptional({
    description: 'Reason for revoking the token.',
    example: 'User logged out',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
