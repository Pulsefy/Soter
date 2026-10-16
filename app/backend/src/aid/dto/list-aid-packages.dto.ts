import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ListAidPackagesDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page',
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number = 10;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['id', 'title', 'status', 'amount'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['id', 'title', 'status', 'amount'])
  sortBy?: string = 'id';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'asc',
  })
  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({
    description: 'Filter by search text (matches id, title, region)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['Active', 'Claimed', 'Expired'],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter by token type',
    enum: ['USDC', 'XLM', 'EURC'],
  })
  @IsOptional()
  @IsString()
  token?: string;
}

export class PaginatedAidPackageResponse<T> {
  @ApiProperty({ description: 'Array of items for the current page' })
  data!: T[];

  @ApiProperty({ description: 'Total number of items matching the query' })
  total!: number;

  @ApiProperty({ description: 'Current page number (1-based)' })
  page!: number;

  @ApiProperty({ description: 'Number of items per page' })
  size!: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages!: number;
}

export class ListRecipientPackagesQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page',
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number = 10;
}

export class RecipientPackageCountResponse {
  @ApiProperty({ description: 'Recipient address' })
  recipient!: string;

  @ApiProperty({ description: 'Total number of packages held by the recipient' })
  count!: number;
}

export class ListRecipientPackagesResponse<T> {
  @ApiProperty({ description: 'Array of packages for the current page' })
  data!: T[];

  @ApiProperty({ description: 'Total number of packages held by the recipient' })
  total!: number;

  @ApiProperty({ description: 'Current page number (1-based)' })
  page!: number;

  @ApiProperty({ description: 'Number of items per page' })
  size!: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages!: number;
}
