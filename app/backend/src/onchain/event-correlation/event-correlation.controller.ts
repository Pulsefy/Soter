import {
  Controller,
  Post,
  Query,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { EventCorrelationService } from './event-correlation.service';
import { CorrelationResult } from './dto/correlation-result.dto';

/**
 * Exposes the on-demand event correlation trigger endpoint.
 *
 * POST /v1/onchain/events/correlate
 *
 * Task 6.1 — Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
@Controller('v1/onchain/events')
export class EventCorrelationController {
  constructor(
    private readonly correlationService: EventCorrelationService,
  ) {}

  /**
   * Trigger an on-demand correlation run.
   *
   * Query params:
   *   startLedger — optional positive integer; defaults to the stored cursor
   *   endLedger   — optional positive integer >= startLedger; defaults to latest ledger
   */
  @Post('correlate')
  async correlate(
    @Query('startLedger') startLedger?: string,
    @Query('endLedger') endLedger?: string,
  ): Promise<CorrelationResult> {
    // --- Parse & validate startLedger ---
    let startLedgerInt: number | undefined;
    if (startLedger !== undefined) {
      startLedgerInt = parseInt(startLedger, 10);
      if (isNaN(startLedgerInt) || startLedgerInt <= 0) {
        throw new BadRequestException('startLedger must be a positive integer');
      }
    }

    // --- Parse & validate endLedger ---
    let endLedgerInt: number | undefined;
    if (endLedger !== undefined) {
      endLedgerInt = parseInt(endLedger, 10);
      if (isNaN(endLedgerInt)) {
        throw new BadRequestException('endLedger must be a positive integer');
      }
      // Cross-field validation: endLedger must be >= startLedger when both are provided
      if (startLedgerInt !== undefined && endLedgerInt < startLedgerInt) {
        throw new BadRequestException('endLedger must be >= startLedger');
      }
    }

    // --- Delegate to service, mapping RPC connectivity errors to HTTP 502 ---
    try {
      return await this.correlationService.correlate(startLedgerInt, endLedgerInt);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const lowerMsg = message.toLowerCase();

      if (
        lowerMsg.includes('econnrefused') ||
        lowerMsg.includes('fetch failed') ||
        lowerMsg.includes('network') ||
        lowerMsg.includes('enotfound')
      ) {
        throw new HttpException(
          { message: 'Soroban RPC unreachable', error: message },
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Re-throw all other errors as-is
      throw err;
    }
  }
}
