import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDelegateDto {
  @ApiPropertyOptional({
    description: 'New delegate Stellar address, or null to remove',
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
  })
  @IsOptional()
  @IsString()
  @Matches(/^G[A-Z0-9]{55}$|^C[A-Z0-9]{55}$/, {
    message: 'delegateAddress must be a valid Stellar address (G... or C... format)',
  })
  delegateAddress: string | null;
}
