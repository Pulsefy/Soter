import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ArrayUnique,
  ValidateIf,
} from 'class-validator';
import { AppRole } from '../../auth/app-role.enum';
import { ApiKeyScope } from '../api-key-scope.enum';

export class CreateApiKeyDto {
  @ApiProperty({
    enum: AppRole,
    description: 'Role associated with this API key.',
    example: AppRole.operator,
  })
  @IsEnum(AppRole)
  role!: AppRole;

  @ApiPropertyOptional({
    enum: ApiKeyScope,
    isArray: true,
    description:
      'Scopes granted to this API key. Defaults to [admin] if omitted.',
    example: [ApiKeyScope.read, ApiKeyScope.write],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(ApiKeyScope, { each: true })
  scopes?: ApiKeyScope[];

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

  @ApiPropertyOptional({
    description:
      'Optional absolute expiry (ISO-8601). Mutually exclusive with expiresInDays.',
    example: '2027-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description:
      'Optional relative TTL in days from creation. Mutually exclusive with expiresAt.',
    example: 90,
    minimum: 1,
    maximum: 3650,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}
