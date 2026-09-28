import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DisburseClaimDto {
  @ApiPropertyOptional({
    description:
      'Optional receipt metadata pointer (URI or hash) emitted on the ' +
      'on-chain PackageDisbursed event for off-chain receipt discovery.',
    example: 'ipfs://QmReceipt123',
  })
  @IsOptional()
  @IsString()
  receiptPointer?: string;
}
