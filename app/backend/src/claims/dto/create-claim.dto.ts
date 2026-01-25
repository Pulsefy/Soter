import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateClaimDto {
  @ApiProperty({ description: 'ID of the campaign this claim belongs to' })
  @IsString()
  campaignId: string;

  @ApiProperty({ description: 'Amount of the claim', minimum: 0 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ description: 'Reference to the recipient' })
  @IsString()
  recipientRef: string;

  @ApiProperty({ description: 'Reference to evidence', required: false })
  @IsOptional()
  @IsString()
  evidenceRef?: string;
}
