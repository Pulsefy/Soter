import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RevokeApiKeyDto {
  @ApiPropertyOptional({
    description: 'Optional reason for revocation.',
    example: 'compromised',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
