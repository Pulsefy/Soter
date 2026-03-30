import { IsString, IsOptional, IsNumber, IsArray, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * DTO for creating a single aid package
 */
export class CreateAidPackageDto {
  @ApiProperty({
    description: 'Unique identifier for the package',
    example: 'pkg_123456789',
  })
  @IsString()
  packageId: string;

  @ApiProperty({
    description: 'Stellar address of the aid recipient',
    example: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
  })
  @IsString()
  recipientAddress: string;

  @ApiProperty({
    description: 'Amount in stroops (i128 as string to preserve precision)',
    example: '1000000000',
  })
  @IsString()
  amount: string;

  @ApiProperty({
    description: 'Stellar token address',
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
  })
  @IsString()
  tokenAddress: string;

  @ApiProperty({
    description: 'Unix timestamp when the package expires',
    example: 1704067200,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expiresAt: number;

  @ApiProperty({
    description: 'Optional metadata as key-value pairs',
    example: { campaign_ref: 'campaign-123', region: 'LATAM' },
    required: false,
  })
  @IsOptional()
  metadata?: Record<string, string>;
}

/**
 * DTO for batch creating aid packages
 */
export class BatchCreateAidPackagesDto {
  @ApiProperty({
    description: 'Array of recipient Stellar addresses',
    example: [
      'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
      'GA5ZSEJYB37JRC5AVCIA5MOP4GZ5DA47EL5QRUVLYEK2OOABEXVR5CV7',
    ],
  })
  @IsArray()
  @IsString({ each: true })
  recipientAddresses: string[];

  @ApiProperty({
    description: 'Array of amounts (in stroops, as strings)',
    example: ['1000000000', '500000000'],
  })
  @IsArray()
  @IsString({ each: true })
  amounts: string[];

  @ApiProperty({
    description: 'Stellar token address',
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
  })
  @IsString()
  tokenAddress: string;

  @ApiProperty({
    description: 'Duration in seconds from now until expiration',
    example: 2592000, // 30 days
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expiresIn: number;

  @ApiProperty({
    description: 'Optional metadata as key-value pairs',
    required: false,
  })
  @IsOptional()
  metadata?: Record<string, string>;
}

/**
 * DTO for claiming an aid package
 */
export class ClaimAidPackageDto {
  @ApiProperty({
    description: 'Package ID to claim',
    example: 'pkg_123456789',
  })
  @IsString()
  packageId: string;
}

/**
 * DTO for disbursing an aid package
 */
export class DisburseAidPackageDto {
  @ApiProperty({
    description: 'Package ID to disburse',
    example: 'pkg_123456789',
  })
  @IsString()
  packageId: string;
}

/**
 * DTO for retrieving aid package details
 */
export class GetAidPackageDto {
  @ApiProperty({
    description: 'Package ID to retrieve',
    example: 'pkg_123456789',
  })
  @IsString()
  packageId: string;
}

/**
 * DTO for retrieving aggregated package statistics
 */
export class GetAidPackageStatsDto {
  @ApiProperty({
    description: 'Token address for which to retrieve statistics',
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
  })
  @IsString()
  tokenAddress: string;
}
