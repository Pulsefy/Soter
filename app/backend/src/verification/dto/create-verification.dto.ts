import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsDate } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVerificationDto {
  @ApiProperty({
    description: 'User submitting the verification',
    example: 'clu456def789',
  })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    description: 'Document type being submitted',
    example: 'NATIONAL_ID',
  })
  @IsString()
  @IsNotEmpty()
  documentType!: string;

  @ApiPropertyOptional({
    description: 'Timestamp when the verification request was submitted.',
    example: '2025-01-23T11:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  submittedAt?: Date;
}
