import { IsOptional, IsIn, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export class QueryInboxDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'], {
    message: 'status must be one of: pending, approved, rejected',
  })
  status?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO date string (e.g. 2024-01-01)' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string (e.g. 2024-12-31)' })
  to?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(0)
  offset?: number = 0;
}