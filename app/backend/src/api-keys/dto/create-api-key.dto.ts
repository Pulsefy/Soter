import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AppRole } from '../../auth/app-role.enum';

export class CreateApiKeyDto {
  @ApiProperty({
    enum: AppRole,
    description: 'Role associated with this API key.',
    example: AppRole.operator,
  })
  @IsEnum(AppRole)
  role!: AppRole;

  @ApiPropertyOptional({
    description: 'Optional NGO scope for this key (required for NGO role).',
    example: 'ngo_123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ngoId?: string;

  @ApiPropertyOptional({
    description: 'Human-friendly description of the key purpose.',
    example: 'Onchain worker (prod)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}
