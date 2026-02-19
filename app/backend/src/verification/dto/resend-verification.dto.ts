import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ResendVerificationDto {
  @ApiProperty({
    description: 'Verification session ID returned from start',
    example: 'clv789xyz123',
  })
  @IsString()
  @IsNotEmpty()
  sessionId!: string;
}
