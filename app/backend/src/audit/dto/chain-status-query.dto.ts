import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

const SEQUENCE_PATTERN = /^[1-9]\d{0,17}$/;
const SEQUENCE_MESSAGE = 'must be a positive integer sequence number';

/**
 * Optional inclusive sequence range for `GET /audit/chain/status`.
 * Omit both for a full-chain verification. See docs/audit-log-integrity.md
 * (section 3.2) for the semantics of partial-range verification.
 */
export class ChainStatusQuery {
  @ApiPropertyOptional({
    description: 'First sequence number to verify (inclusive).',
    example: '1000',
  })
  @IsOptional()
  @Matches(SEQUENCE_PATTERN, { message: `fromSequence ${SEQUENCE_MESSAGE}` })
  fromSequence?: string;

  @ApiPropertyOptional({
    description: 'Last sequence number to verify (inclusive).',
    example: '1999',
  })
  @IsOptional()
  @Matches(SEQUENCE_PATTERN, { message: `toSequence ${SEQUENCE_MESSAGE}` })
  toSequence?: string;
}
