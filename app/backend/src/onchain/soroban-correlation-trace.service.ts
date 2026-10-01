import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SorobanEventCorrelation,
  SorobanTransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';

type SorobanTransactionWithClaim = Prisma.SorobanTransactionGetPayload<{
  include: {
    claim: {
      select: {
        id: true;
        status: true;
        amount: true;
        campaignId: true;
      };
    };
  };
}>;

export interface CorrelationTrace {
  correlationId: string;
  /** Whether anything at all was found for this correlation ID. */
  found: boolean;
  /** Claims touched anywhere in the chain (from the transaction records). */
  claimIds: string[];
  /** On-chain transaction hashes reached by the chain. */
  txHashes: string[];
  /** Soroban lifecycle records, oldest first. */
  transactions: SorobanTransactionWithClaim[];
  /** On-chain events correlated to those transactions/claims, oldest ledger first. */
  events: SorobanEventCorrelation[];
  summary: {
    transactionCount: number;
    confirmedTransactionCount: number;
    failedTransactionCount: number;
    pendingTransactionCount: number;
    eventCount: number;
    startedAt: Date | null;
    lastActivityAt: Date | null;
    durationMs: number | null;
  };
}

const TRANSACTION_CONTEXT = 'SorobanCorrelationTraceService';

/**
 * Read-only view over everything a single correlation ID touched.
 *
 * Replaces the manual log cross-referencing needed to follow one claim
 * disbursement from the originating HTTP request down to the on-chain event:
 * given a correlation ID it returns the Soroban lifecycle records that carry
 * it plus every event correlation reachable from those records (matched by
 * transaction hash and by claim).
 */
@Injectable()
export class SorobanCorrelationTraceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loggerService: LoggerService,
  ) {}

  async getTrace(correlationId: string): Promise<CorrelationTrace> {
    const normalized = correlationId.trim();

    const transactions = await this.prisma.sorobanTransaction.findMany({
      where: { correlationId: normalized },
      orderBy: { createdAt: 'asc' },
      include: {
        claim: {
          select: {
            id: true,
            status: true,
            amount: true,
            campaignId: true,
          },
        },
      },
    });

    const txHashes = this.uniqueDefined(transactions.map(tx => tx.txHash));
    const claimIds = this.uniqueDefined(
      transactions.map(tx => tx.claimId),
      transactions.flatMap(tx => (tx.claim ? [tx.claim.id] : [])),
    );

    // An event is part of the chain when it belongs to one of the on-chain
    // transactions we tracked, or to one of the claims those transactions were
    // executed for (the latter covers events recorded before the hash was
    // written back to the transaction record).
    const eventFilters: Prisma.SorobanEventCorrelationWhereInput[] = [];
    if (txHashes.length > 0) {
      eventFilters.push({ txHash: { in: txHashes } });
    }
    if (claimIds.length > 0) {
      eventFilters.push({ claimId: { in: claimIds } });
    }

    const events =
      eventFilters.length > 0
        ? await this.prisma.sorobanEventCorrelation.findMany({
            where: { OR: eventFilters },
            orderBy: { ledger: 'asc' },
          })
        : [];

    const timestamps = [
      ...transactions.map(tx => tx.createdAt),
      ...events.map(event => event.createdAt),
    ];
    const startedAt = timestamps.length > 0 ? this.minDate(timestamps) : null;
    const lastActivityAt =
      timestamps.length > 0 ? this.maxDate(timestamps) : null;

    const trace: CorrelationTrace = {
      correlationId: normalized,
      found: transactions.length > 0 || events.length > 0,
      claimIds,
      txHashes,
      transactions,
      events,
      summary: {
        transactionCount: transactions.length,
        confirmedTransactionCount: transactions.filter(
          tx => tx.status === SorobanTransactionStatus.confirmed,
        ).length,
        failedTransactionCount: transactions.filter(
          tx => tx.status === SorobanTransactionStatus.failed,
        ).length,
        pendingTransactionCount: transactions.filter(
          tx =>
            tx.status === SorobanTransactionStatus.pending ||
            tx.status === SorobanTransactionStatus.submitted,
        ).length,
        eventCount: events.length,
        startedAt,
        lastActivityAt,
        durationMs:
          startedAt && lastActivityAt
            ? lastActivityAt.getTime() - startedAt.getTime()
            : null,
      },
    };

    this.loggerService.debug(
      'Resolved Soroban correlation trace',
      TRANSACTION_CONTEXT,
      {
        correlationId: normalized,
        transactionCount: transactions.length,
        eventCount: events.length,
        claimIds,
      },
    );

    return trace;
  }

  private uniqueDefined(
    ...values: Array<Array<string | null | undefined>>
  ): string[] {
    return [
      ...new Set(
        values
          .flat()
          .filter(
            (value): value is string =>
              typeof value === 'string' && value.length > 0,
          ),
      ),
    ];
  }

  private minDate(dates: Date[]): Date {
    return new Date(Math.min(...dates.map(date => date.getTime())));
  }

  private maxDate(dates: Date[]): Date {
    return new Date(Math.max(...dates.map(date => date.getTime())));
  }
}
