import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { VerificationService } from './verification.service';
import {
  VerificationJobData,
  VerificationResult,
} from './interfaces/verification-job.interface';
import { DeadLetterService } from '../jobs/dead-letter.service';

@Processor('verification', {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
})
export class VerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(VerificationProcessor.name);

  constructor(
    private readonly verificationService: VerificationService,
    @Optional()
    private readonly deadLetterService: DeadLetterService | null,
  ) {
    super();
  }

  async process(
    job: Job<VerificationJobData, VerificationResult, string>,
  ): Promise<VerificationResult> {
    this.logger.log(
      `Processing job ${job.id} for claim ${job.data.claimId} ` +
        `(attempt ${job.attemptsMade + 1}/${job.opts?.attempts ?? '?'})`,
    );

    try {
      const result = await this.verificationService.processVerification(
        job.data,
      );

      this.logger.log(
        `Job ${job.id} completed successfully with score ${result.score}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Job ${job.id} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<VerificationJobData, VerificationResult>): void {
    this.logger.log(
      `Job ${job.id} completed for claim ${job.data.claimId} ` +
        `after ${Date.now() - job.data.timestamp}ms`,
    );
  }

  /**
   * Called after the final failed attempt.
   * Moves the job to the Dead Letter Queue when all retries are exhausted.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<VerificationJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      this.logger.error(`Verification job failed (no job reference): ${error.message}`);
      return;
    }

    const maxAttempts = job.opts?.attempts ?? 3;
    const isExhausted = job.attemptsMade >= maxAttempts;

    this.logger.error(
      `Job ${job.id} failed for claim ${job.data.claimId} on attempt ` +
        `${job.attemptsMade}/${maxAttempts}: ${error.message}`,
    );

    if (isExhausted && this.deadLetterService) {
      await this.deadLetterService.moveToDeadLetter('verification', job, error);
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job<VerificationJobData>): void {
    this.logger.debug(`Job ${job.id} started for claim ${job.data.claimId}`);
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(`Verification job ${jobId} stalled`);
  }

  @OnWorkerEvent('progress')
  onProgress(job: Job<VerificationJobData>, progress: number | object): void {
    this.logger.debug(`Job ${job.id} progress: ${JSON.stringify(progress)}`);
  }
}
