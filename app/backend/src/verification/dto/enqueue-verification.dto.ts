import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class EnqueueVerificationDto {
  @ApiProperty({
    description: 'Claim ID to verify',
    example: 'clv789xyz123',
  })
  @IsString()
  @IsNotEmpty()
  claimId: string;
}
