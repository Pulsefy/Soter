import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ProcessTextIntakeDto {
  @ApiProperty({
    description: 'Text content to process for language detection, translation, and normalization',
    example: 'Nous avons besoin d\'aide d\'urgence pour notre famille de cinq personnes.',
  })
  @IsString()
  @IsNotEmpty()
  text!: string;
}