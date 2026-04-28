import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateInternalNoteDto {
  @ApiProperty({
    description: 'The content of the internal note.',
    example:
      'Investigation shows that the recipient has provided valid evidence.',
  })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiPropertyOptional({
    description: 'Optional category for the note.',
    example: 'investigation',
  })
  @IsString()
  @IsOptional()
  category?: string;
}
