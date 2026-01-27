import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { VerificationService } from './verification.service';
import {
  VerificationJobData,
  VerificationResult,
} from './interfaces/verification-job.interface';

@Processor('verification', {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
})
export class VerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(VerificationProcessor.name);

  constructor(private readonly verificationService: VerificationService) {
    super();
  }

  async process(
    job: Job<VerificationJobData, VerificationResult, string>,
  ): Promise<VerificationResult> {
    this.logger.log(
      `Processing job ${job.id} for claim ${job.data.claimId} (attempt ${job.attemptsMade + 1})`,
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
  onCompleted(job: Job<VerificationJobData, VerificationResult>) {
    this.logger.log(
      `Job ${job.id} completed for claim ${job.data.claimId} after ${Date.now() - job.data.timestamp}ms`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<VerificationJobData> | undefined, error: Error) {
    if (job) {
      this.logger.error(
        `Job ${job.id} failed for claim ${job.data.claimId}: ${error.message}`,
      );
    } else {
      this.logger.error(`Job failed: ${error.message}`);
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job<VerificationJobData>) {
    this.logger.debug(`Job ${job.id} started for claim ${job.data.claimId}`);
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} stalled`);
  }

  @OnWorkerEvent('progress')
  onProgress(job: Job<VerificationJobData>, progress: number | object) {
    this.logger.debug(`Job ${job.id} progress: ${JSON.stringify(progress)}`);
  }
}
