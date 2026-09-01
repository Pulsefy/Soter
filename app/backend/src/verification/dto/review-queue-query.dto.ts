import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClaimStatus } from '@prisma/client';

export enum ReviewQueuePaginationMode {
  PAGE = 'page',
  CURSOR = 'cursor',
}

const normalizeStatusFilter = ({
  value,
}: {
  value: unknown;
}): ClaimStatus[] | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .flatMap(entry => String(entry).split(','))
    .map(entry => entry.trim())
    .filter((entry): entry is ClaimStatus => entry.length > 0);

  return normalized.length > 0 ? normalized : undefined;
};

@ValidatorConstraint({ name: 'ReviewQueuePaginationMode', async: false })
class ReviewQueuePaginationModeConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const dto = args.object as ReviewQueueQueryDto;
    const mode = dto.getPaginationMode();

    if (mode === ReviewQueuePaginationMode.CURSOR) {
      return dto.page === undefined;
    }

    return dto.cursor === undefined;
  }

  defaultMessage(args?: ValidationArguments): string {
    const dto = args?.object as ReviewQueueQueryDto;
    const mode = dto.getPaginationMode();

    if (mode === ReviewQueuePaginationMode.CURSOR) {
      return 'page pagination cannot be combined with cursor pagination mode';
    }

    return 'cursor cannot be combined with page pagination mode';
  }
}

@ValidatorConstraint({ name: 'ReviewQueueDateRange', async: false })
class ReviewQueueDateRangeConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const dto = args.object as ReviewQueueQueryDto;

    if (!dto.fromDate || !dto.toDate) {
      return true;
    }

    return new Date(dto.fromDate).getTime() <= new Date(dto.toDate).getTime();
  }

  defaultMessage(): string {
    return 'fromDate must be earlier than or equal to toDate';
  }
}

function ValidatePaginationMode(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: ReviewQueuePaginationModeConstraint,
    });
  };
}

function ValidateDateRange(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: ReviewQueueDateRangeConstraint,
    });
  };
}

export class ReviewQueueQueryDto {
  @ApiPropertyOptional({
    description:
      'Pagination strategy. Use cursor mode to start cursor-based pagination from the first request.',
    enum: ReviewQueuePaginationMode,
    enumName: 'ReviewQueuePaginationMode',
    example: ReviewQueuePaginationMode.PAGE,
  })
  @IsOptional()
  @IsEnum(ReviewQueuePaginationMode)
  paginationMode?: ReviewQueuePaginationMode;

  @ApiPropertyOptional({
    description:
      'Filter by one or more claim statuses. Accepts repeated query params or a comma-separated list.',
    enum: ClaimStatus,
    enumName: 'ClaimStatus',
    isArray: true,
    example: ['requested', 'verified'],
  })
  @IsOptional()
  @Transform(normalizeStatusFilter)
  @IsEnum(ClaimStatus, { each: true })
  status?: ClaimStatus[];

  @ApiPropertyOptional({
    description: 'Filter queue items by campaign ID.',
    example: 'cmdemo123campaign',
  })
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional({
    description:
      'Filter queue items created on or after this ISO-8601 timestamp.',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({
    description:
      'Filter queue items created on or before this ISO-8601 timestamp.',
    example: '2026-01-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({
    description: 'Page number for page/limit pagination.',
    minimum: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Maximum number of items to return.',
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque cursor returned by a previous review queue request.',
    example:
      'eyJjcmVhdGVkQXQiOiIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImNtZGVtbzEyM2NsYWltIn0',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'cursor must be a valid opaque cursor string',
  })
  cursor?: string;

  @ApiHideProperty()
  @ValidatePaginationMode()
  paginationModeValidation?: never;

  @ApiHideProperty()
  @ValidateDateRange()
  dateRangeValidation?: never;

  getPaginationMode(): ReviewQueuePaginationMode {
    if (this.paginationMode) {
      return this.paginationMode;
    }

    return this.cursor
      ? ReviewQueuePaginationMode.CURSOR
      : ReviewQueuePaginationMode.PAGE;
  }
}
