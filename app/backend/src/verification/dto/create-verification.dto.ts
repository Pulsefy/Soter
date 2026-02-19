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

  @ApiPropertyOptional({ description: 'Optional submission timestamp' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  submittedAt?: Date;
}
