import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * Stellar addresses are 56-character base32 payloads prefixed by the account
 * kind: `G` for accounts, `C` for contracts, `M` for muxed accounts. Validating
 * the shape here rejects a typo with a 422 instead of burning an on-chain
 * simulation round trip.
 */
const STELLAR_ADDRESS_PATTERN = /^[GCM][A-Z0-9]{55}$/;

export class ProposeAdminTransferDto {
  @ApiProperty({
    description:
      'Stellar address nominated as the next contract admin. Must differ from the current admin.',
    example: 'GDESTINATIONADDRESS000000000000000000000000000000000',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(56)
  @Matches(STELLAR_ADDRESS_PATTERN, {
    message:
      'newAdminAddress must be a 56-character Stellar address starting with G, C, or M',
  })
  newAdminAddress: string;
}
