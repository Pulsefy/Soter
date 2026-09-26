import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SearchIndexEntityType } from '@prisma/client';
import {
  MAX_SEARCH_INDEX_BATCH_SIZE,
  MIN_SEARCH_INDEX_BATCH_SIZE,
} from '../search-index.constants';

export class StartSearchIndexRebuildDto {
  @ApiPropertyOptional({
    description:
      'When true, report per-entity document counts without mutating the index.',
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, continue a previously interrupted (stale) rebuild from its checkpoint instead of starting fresh.',
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  resume?: boolean;

  @ApiPropertyOptional({
    description: 'Number of documents processed per bounded batch.',
    default: 100,
    minimum: MIN_SEARCH_INDEX_BATCH_SIZE,
    maximum: MAX_SEARCH_INDEX_BATCH_SIZE,
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(MIN_SEARCH_INDEX_BATCH_SIZE)
  @Max(MAX_SEARCH_INDEX_BATCH_SIZE)
  batchSize?: number;

  @ApiPropertyOptional({
    description:
      'Entity types to rebuild. Defaults to all indexable entity types.',
    isArray: true,
    enum: SearchIndexEntityType,
    default: ['campaign', 'claim', 'recipient', 'verification'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(SearchIndexEntityType, { each: true })
  entityTypes?: SearchIndexEntityType[];
}
