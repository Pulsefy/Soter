/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Inject, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  OnchainJobData,
  OnchainJobResult,
  OnchainOperationType,
} from './interfaces/onchain-job.interface';
import { ONCHAIN_ADAPTER_TOKEN, OnchainAdapter } from './onchain.adapter';
import { DeadLetterService } from '../jobs/dead-letter.service';

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

/** Errors that indicate a transient network or RPC issue – safe to retry. */
const NETWORK_ERROR_PATTERNS = [
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /network timeout/i,
  /request timeout/i,
  /fetch failed/i,
  /ECONNABORTED/i,
];

/**
 * Errors that indicate Stellar ledger congestion or rate-limiting.
 * These warrant a longer back-off before retrying.
 */
const LEDGER_CONGESTION_PATTERNS = [
  /tx_insufficient_fee/i,
  /too many requests/i,
  /rate.?limit/i,
  /ledger.?full/i,
  /surge.?pricing/i,
  /503/,
  /429/,
];

/** Errors that are permanent – no point retrying. */
const PERMANENT_ERROR_PATTERNS = [
  /tx_bad_auth/i,
  /tx_bad_seq/i,
  /contract.?not.?found/i,
  /invalid.?contract/i,
  /SOROBAN_CONTRACT_ID is not configured/i,
];

function classifyError(error: Error): 'network' | 'congestion' | 'permanent' | 'unknown' {
  const msg = error.message;
  if (PERMANENT_ERROR_PATTERNS.some(p => p.test(msg))) return 'permanent';
  if (LEDGER_CONGESTION_PATTERNS.some(p => p.test(msg))) return 'congestion';
  if (NETWORK_ERROR_PATTERNS.some(p => p.test(msg))) return 'network';
  return 'unknown';
}

/** Add random jitter (±25 %) to a delay to avoid thundering-herd on retry. */
function withJitter(delayMs: number): number {
  const jitter = delayMs * 0.25;
  return Math.round(delayMs + (Math.random() * 2 - 1) * jitter);
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

@Processor('onchain', {
  concurrency: 1, // Sequential – blockchain transactions must not race
})
export class OnchainProcessor extends WorkerHost {
  private readonly logger = new Logger(OnchainProcessor.name);

  /** Default per-operation timeout in ms (overridable via env). */
  private readonly operationTimeoutMs: number;

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    /**
     * DeadLetterService is optional so the processor still boots in
     * environments where JobsModule is not loaded (e.g. isolated unit tests).
     */
    @Optional()
    private readonly deadLetterService: DeadLetterService | null,
  ) {
    super();
    this.operationTimeoutMs = parseInt(
      process.env.ONCHAIN_OPERATION_TIMEOUT_MS ?? '30000',
      10,
    );
  }

  // -------------------------------------------------------------------------
  // Main processing logic
  // -------------------------------------------------------------------------

  async process(
    job: Job<OnchainJobData, OnchainJobResult, string>,
  ): Promise<OnchainJobResult> {
    this.logger.log(
      `Processing onchain ${job.data.type} job ${job.id} ` +
        `(attempt ${job.attemptsMade + 1}/${job.opts?.attempts ?? '?'})`,
    );

    try {
      const result = await this.executeWithTimeout(job);

      if (result && 'status' in result && result.status === 'failed') {
        throw new Error(`Onchain operation reported failure: ${String(job.data.type)}`);
      }

      return {
        success: true,
        transactionHash: result?.transactionHash,
        metadata: result?.metadata,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const kind = classifyError(err);

      this.logger.error(
        `Onchain job ${job.id} failed [${kind}] on attempt ` +
          `${job.attemptsMade + 1}: ${err.message}`,
        err.stack,
      );

      // For permanent errors, exhaust retries immediately by re-throwing
      // with a flag so BullMQ moves the job to failed state right away.
      if (kind === 'permanent') {
        this.logger.warn(
          `Onchain job ${job.id} has a permanent error – marking as ` +
            `unrecoverable without further retries.`,
        );
        // Discard remaining attempts by setting attemptsMade to max
        // BullMQ checks attemptsMade >= attempts before scheduling a retry
        job.discard();
      }

      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Worker event hooks
  // -------------------------------------------------------------------------

  @OnWorkerEvent('completed')
  onCompleted(job: Job<OnchainJobData, OnchainJobResult>): void {
    this.logger.log(
      `Onchain job ${job.id} (${job.data.type}) completed successfully ` +
        `in ${Date.now() - job.data.timestamp}ms`,
    );
  }

  /**
   * Called by BullMQ after the final failed attempt.
   * When all retries are exhausted we move the job to the Dead Letter Queue.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<OnchainJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      this.logger.error(`Onchain job failed (no job reference): ${error.message}`);
      return;
    }

    const maxAttempts = job.opts?.attempts ?? 5;
    const isExhausted = job.attemptsMade >= maxAttempts;

    this.logger.error(
      `Onchain job ${job.id} (${job.data.type}) failed on attempt ` +
        `${job.attemptsMade}/${maxAttempts}: ${error.message}`,
    );

    if (isExhausted && this.deadLetterService) {
      await this.deadLetterService.moveToDeadLetter('onchain', job, error);
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(
      `Onchain job ${jobId} stalled – worker may have crashed mid-transaction. ` +
        `BullMQ will automatically retry.`,
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Execute the adapter call with a hard timeout.
   * Throws a descriptive error if the RPC call takes too long.
   */
  private async executeWithTimeout(
    job: Job<OnchainJobData, OnchainJobResult, string>,
  ): Promise<any> {
    const timeoutMs = this.resolveTimeout(job);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `network timeout: onchain operation ${job.data.type} exceeded ${timeoutMs}ms`,
            ),
          ),
        timeoutMs,
      ),
    );

    const operationPromise = this.dispatchOperation(job);

    return Promise.race([operationPromise, timeoutPromise]);
  }

  /**
   * Resolve the effective timeout for this job.
   * Congestion retries use a longer timeout to account for slow ledger state.
   */
  private resolveTimeout(job: Job<OnchainJobData>): number {
    const base = this.operationTimeoutMs;
    // Give later attempts more time – ledger may be recovering from congestion
    const multiplier = Math.min(1 + job.attemptsMade * 0.5, 3);
    return withJitter(Math.round(base * multiplier));
  }

  private async dispatchOperation(
    job: Job<OnchainJobData, OnchainJobResult, string>,
  ): Promise<any> {
    switch (job.data.type) {
      case OnchainOperationType.INIT_ESCROW:
        return this.onchainAdapter.initEscrow(job.data.params);

      case OnchainOperationType.CREATE_CLAIM:
        return this.onchainAdapter.createClaim(job.data.params);

      case OnchainOperationType.DISBURSE:
        return this.onchainAdapter.disburse(job.data.params);

      default:
        throw new Error(
          `Unknown onchain operation type: ${String(job.data.type)}`,
        );
    }
  }
}
