import { ApiProperty } from '@nestjs/swagger';
import { CancelReasonCode } from '@prisma/client';

/** One bucket in the cancellation breakdown. */
export class CancellationReasonBreakdownDto {
  @ApiProperty({
    description: 'Structured cancellation reason for this bucket.',
    enum: CancelReasonCode,
    example: CancelReasonCode.duplicate,
  })
  code!: CancelReasonCode;

  @ApiProperty({
    description: 'Number of cancelled claims in this bucket.',
    example: 12,
  })
  count!: number;

  @ApiProperty({
    description: 'Sum of the claim amounts in this bucket.',
    example: 8400,
  })
  totalAmount!: number;
}

export class CancellationReportDto {
  @ApiProperty({
    description:
      'Total cancelled claims matching the filter, across all codes.',
    example: 37,
  })
  totalCancelled!: number;

  @ApiProperty({
    description: 'Sum of amounts across all matching cancelled claims.',
    example: 25300,
  })
  totalAmount!: number;

  @ApiProperty({
    description:
      'Cancelled claims matching the filter that predate the reason code ' +
      'enum and therefore have no code. Should be 0 for claims cancelled ' +
      'after the migration landed.',
    example: 0,
  })
  uncodedCount!: number;

  @ApiProperty({
    description: 'Cancellation counts and amounts grouped by reason code.',
    type: [CancellationReasonBreakdownDto],
  })
  breakdown!: CancellationReasonBreakdownDto[];
}
