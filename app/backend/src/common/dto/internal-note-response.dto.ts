import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InternalNoteResponseDto {
  @ApiProperty({ example: 'clv789xyz123' })
  id!: string;

  @ApiProperty({ example: 'claim' })
  entityType!: string;

  @ApiProperty({ example: 'clv789xyz123' })
  entityId!: string;

  @ApiProperty({ example: 'Investigation notes...' })
  content!: string;

  @ApiProperty({ example: 'clv789xyz123' })
  authorId!: string;

  @ApiPropertyOptional({ example: 'investigation', nullable: true })
  category?: string | null;

  @ApiProperty({ example: '2025-01-23T11:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2025-01-23T11:00:00.000Z' })
  updatedAt!: Date;
}
