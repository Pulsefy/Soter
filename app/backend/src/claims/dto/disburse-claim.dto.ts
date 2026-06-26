import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DisburseClaimDto {
  @ApiPropertyOptional({
    description: 'Optional receipt hash to anchor the claim or disbursement event to an off-chain receipt.',
    example: '3a7bd3e2360a9e1f7c4d7e8f6a1234567890abcdef1234567890abcdef123456',
  })
  @IsOptional()
  @IsString()
  receiptHash?: string;
}
