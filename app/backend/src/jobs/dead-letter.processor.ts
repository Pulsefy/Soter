import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

export interface DeadLetterJobData {
  /** Original queue the job came from */
  originalQueue: string;
  /** Original job ID */
  originalJobId: string;
  /** Original job name */
  originalJobName: string;
  /** Original job payload */
  originalData: unknown;
  /** Error message from the final failure */
  failureReason: string;
  /** Stack trace if available */
  failureStack?: string;
  /** Total attempts made before giving up */
  attemptsMade: number;
  /** Unix timestamp (ms) when the job was moved to DLQ */
  deadAt: number;
}

/**
 * Dead Letter Queue processor.
 *
 * Jobs land here after exhausting all retries in their source queue.
 * The processor persists a structured failure record and emits an alert
 * log so operators can triage without digging through Redis directly.
 *
 * Future extension points:
 *  - Persist to a `dead_letter_jobs` DB table via PrismaService
 *  - Emit a Prometheus counter / alert
 *  - Publish to a Slack / PagerDuty webhook
 */
@Processor('dead-letter', { concurrency: 1 })
export class DeadLetterProcessor extends WorkerHost {
  private readonly logger = new Logger(DeadLetterProcessor.name);

  async process(job: Job<DeadLetterJobData>): Promise<void> {
    const { originalQueue, originalJobId, failureReason, attemptsMade } =
      job.data;

    this.logger.error(
      `[DLQ] Job ${originalJobId} from queue "${originalQueue}" permanently failed ` +
        `after ${attemptsMade} attempt(s). Reason: ${failureReason}`,
    );

    // Structured log for log-aggregation pipelines (Datadog, CloudWatch, etc.)
    this.logger.error(
      JSON.stringify({
        event: 'dead_letter_job',
        originalQueue,
        originalJobId,
        originalJobName: job.data.originalJobName,
        failureReason,
        attemptsMade,
        deadAt: new Date(job.data.deadAt).toISOString(),
      }),
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<DeadLetterJobData>): void {
    this.logger.log(
      `[DLQ] Dead-letter record ${job.id} processed for original job ` +
        `${job.data.originalJobId} (queue: ${job.data.originalQueue})`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<DeadLetterJobData> | undefined, error: Error): void {
    this.logger.error(
      `[DLQ] Failed to process dead-letter record ${job?.id}: ${error.message}`,
    );
  }
}
