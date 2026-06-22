import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Length, Matches } from 'class-validator';

export class CompleteVerificationDto {
  @ApiProperty({
    description: 'Unique identifier for the current verification session.',
    example: 'ses_123abc456def',
  })
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @ApiProperty({
    description: 'OTP code received via email or phone',
    example: '123456',
    minLength: 4,
    maxLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @Length(4, 8)
  @Matches(/^\d+$/, { message: 'code must contain only digits' })
  code!: string;
}
