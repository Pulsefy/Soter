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

/**
 * i128 amounts are decimal strings. Rejecting exponents, signs, separators and
 * overlong digit runs means the adapter always receives something it can hand
 * to `nativeToScVal` unchanged, and never trips `BigInt` on malformed input.
 */
const POSITIVE_I128_PATTERN = /^[1-9]\d{0,38}$/;

/**
 * Step one of the timelocked surplus withdrawal: everything the contract needs
 * to record the proposal. All three fields are required — a partial proposal
 * would leave the timelock holding an amount or destination the caller never
 * chose.
 */
export class ProposeSurplusWithdrawalDto {
  @ApiProperty({
    description:
      'Destination address that will receive the surplus once the timelock matures.',
    example: 'GDESTINATIONADDRESS000000000000000000000000000000000',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(56)
  @Matches(STELLAR_ADDRESS_PATTERN, {
    message:
      'to must be a 56-character Stellar address starting with G, C, or M',
  })
  to: string;

  @ApiProperty({
    description:
      'Amount to withdraw, in the token smallest unit as a decimal string. Must be greater than zero.',
    example: '1000000000',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'amount must be a decimal string, not a number' })
  @Matches(POSITIVE_I128_PATTERN, {
    message:
      'amount must be a positive integer string of at most 39 digits (i128 base units)',
  })
  amount: string;

  @ApiProperty({
    description:
      'Token contract address to withdraw. Must be on the contract allowlist.',
    example: 'CA3D5KRYM6CB7OWQ6TWYRR3Z4ZT7B32DRH2V2385ST2QY4QCP2CAF5Y',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(56)
  @Matches(STELLAR_ADDRESS_PATTERN, {
    message:
      'token must be a 56-character Stellar address starting with G, C, or M',
  })
  token: string;
}
