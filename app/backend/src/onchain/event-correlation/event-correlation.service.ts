import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { CronTime } from 'cron';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { EventMapper } from './event-mapper';
import { CorrelationResult } from './dto/correlation-result.dto';

const DEFAULT_CRON = '*/5 * * * *';

/**
 * Fetches Soroban contract events from the Stellar RPC, maps them via
 * EventMapper, and persists them idempotently to the OnChainEvent table.
 *
 * Tasks 4.1 and 4.2.
 */
@Injectable()
export class EventCorrelationService implements OnModuleInit {
  private readonly logger = new Logger(EventCorrelationService.name);

  /** Concurrency guard — prevents overlapping scheduled runs. */
  private isRunning = false;

  private readonly rpcUrl: string;
  private readonly contractId: string;
  private readonly pageSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventMapper: EventMapper,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    const rpcUrl = this.configService.get<string>('STELLAR_RPC_URL');
    if (!rpcUrl) {
      throw new Error(
        'STELLAR_RPC_URL is not set. EventCorrelationService cannot start without an RPC endpoint.',
      );
    }
    this.rpcUrl = rpcUrl;
    this.contractId = this.configService.get<string>('AID_ESCROW_CONTRACT_ID', '');
    this.pageSize = this.configService.get<number>('CORRELATION_PAGE_SIZE', 200);
  }

  // ---------------------------------------------------------------------------
  // Module lifecycle
  // ---------------------------------------------------------------------------

  onModuleInit(): void {
    const expr = this.configService.get<string>('CORRELATION_CRON_EXPRESSION');
    if (expr && expr !== DEFAULT_CRON) {
      try {
        const job = this.schedulerRegistry.getCronJob('event-correlation');
        job.setTime(new CronTime(expr));
        job.start();
        this.logger.log(
          `event-correlation cron updated to custom expression: ${expr}`,
        );
      } catch (err) {
        this.logger.warn(
          `Could not update cron expression to "${expr}": ${String(err)}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cursor helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the last processed ledger number.
   * On first run (no cursor row) it calls getLatestLedger() and returns
   * latestLedger - 1 so that the first run picks up very recent events.
   */
  async getCursor(): Promise<number> {
    const row = await this.prisma.correlationCursor.findUnique({
      where: { key: 'default' },
    });
    if (row) {
      return row.lastLedger;
    }

    // First-run bootstrap: start one ledger before the current tip.
    const server = this.createServer();
    const { sequence } = await server.getLatestLedger();
    return sequence - 1;
  }

  /**
   * Persists the last successfully processed ledger as the cursor.
   */
  async setCursor(ledger: number): Promise<void> {
    await this.prisma.correlationCursor.upsert({
      where: { key: 'default' },
      create: { key: 'default', lastLedger: ledger },
      update: { lastLedger: ledger },
    });
  }

  // ---------------------------------------------------------------------------
  // Core correlation logic
  // ---------------------------------------------------------------------------

  /**
   * Fetches events from the Soroban RPC, maps them, upserts into DB, and
   * returns a summary result.
   *
   * @param startLedger  First ledger to include (defaults to cursor value)
   * @param endLedger    Last ledger to include (defaults to latest ledger)
   */
  async correlate(
    startLedger?: number,
    endLedger?: number,
  ): Promise<CorrelationResult> {
    const server = this.createServer();

    // Resolve ledger range
    let resolvedStart: number;
    let resolvedEnd: number;

    try {
      resolvedStart = startLedger ?? (await this.getCursor());
      if (endLedger !== undefined) {
        resolvedEnd = endLedger;
      } else {
        const latest = await server.getLatestLedger();
        resolvedEnd = latest.sequence;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[correlate] Failed to resolve ledger range: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      return {
        fetched: 0,
        correlated: 0,
        inserted: 0,
        updated: 0,
        startLedger: startLedger ?? 0,
        endLedger: endLedger ?? 0,
        error: msg,
      };
    }

    // Fetch events from RPC
    let rawEvents: SorobanRpc.Api.EventResponse[];
    try {
      const response = await server.getEvents({
        startLedger: resolvedStart,
        filters: [
          {
            type: 'contract',
            contractIds: [this.contractId],
          },
        ],
        limit: this.pageSize,
      });
      rawEvents = response.events ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[correlate] RPC getEvents failed for ledger range [${resolvedStart}, ${resolvedEnd}]: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      return {
        fetched: 0,
        correlated: 0,
        inserted: 0,
        updated: 0,
        startLedger: resolvedStart,
        endLedger: resolvedEnd,
        error: msg,
      };
    }

    const fetched = rawEvents.length;

    if (fetched === 0) {
      // Nothing to process; advance cursor to the resolved end so the next
      // run starts from the current tip.
      await this.setCursor(resolvedEnd);
      return {
        fetched: 0,
        correlated: 0,
        inserted: 0,
        updated: 0,
        startLedger: resolvedStart,
        endLedger: resolvedEnd,
      };
    }

    // Process events
    let correlated = 0;
    let inserted = 0;
    let updated = 0;
    let maxLedger = resolvedStart;

    for (const rawEvent of rawEvents) {
      try {
        // Cast to the RawSorobanEvent shape expected by EventMapper
        const payload = await this.eventMapper.map(rawEvent as any);

        const { txHash, topic } = payload;

        // Determine whether the row already exists (insert vs update)
        const existing = await this.prisma.onChainEvent.findUnique({
          where: { txHash_topic: { txHash, topic } },
          select: { id: true },
        });

        await this.prisma.onChainEvent.upsert({
          where: { txHash_topic: { txHash, topic } },
          create: {
            txHash: payload.txHash,
            ledger: payload.ledger,
            topic: payload.topic,
            contractId: payload.contractId,
            packageId: payload.packageId,
            claimId: payload.claimId,
            rawPayload: payload.rawPayload,
            correlatedAt: payload.correlatedAt,
          },
          update: {
            rawPayload: payload.rawPayload,
            correlatedAt: payload.correlatedAt,
          },
        });

        if (existing) {
          updated++;
        } else {
          inserted++;
        }

        correlated++;

        if (payload.ledger > maxLedger) {
          maxLedger = payload.ledger;
        }
      } catch (err) {
        const eventId = (rawEvent as any)?.id ?? 'unknown';
        this.logger.warn(
          `[correlate] Failed to persist event id=${eventId}: ${String(err)}`,
        );
        // Continue processing remaining events
      }
    }

    // Advance cursor to the highest processed ledger
    await this.setCursor(maxLedger);

    return {
      fetched,
      correlated,
      inserted,
      updated,
      startLedger: resolvedStart,
      endLedger: resolvedEnd,
    };
  }

  // ---------------------------------------------------------------------------
  // Scheduled job (Task 4.2)
  // ---------------------------------------------------------------------------

  @Cron(DEFAULT_CRON, { name: 'event-correlation' })
  async scheduledCorrelate(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        '[scheduledCorrelate] Correlation already in progress — skipping this trigger.',
      );
      return;
    }

    this.isRunning = true;
    try {
      const result = await this.correlate();
      if (result.error) {
        this.logger.error(
          `[scheduledCorrelate] Correlation run finished with error: ${result.error}`,
        );
      } else {
        this.logger.log(
          `[scheduledCorrelate] Completed — fetched=${result.fetched} correlated=${result.correlated} inserted=${result.inserted} updated=${result.updated} ledgers=[${result.startLedger},${result.endLedger}]`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[scheduledCorrelate] Unexpected error: ${String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      this.isRunning = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private createServer(): SorobanRpc.Server {
    return new SorobanRpc.Server(this.rpcUrl, {
      allowHttp: this.rpcUrl.startsWith('http://'),
    });
  }
}
