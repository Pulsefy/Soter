/**
 * Job Status Event DTOs
 * Defines the structure of job status events for streaming and webhook delivery
 */

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  RETRYING = 'retrying',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum JobType {
  OCR = 'ocr',
  INFERENCE = 'inference',
  PROOF_OF_LIFE = 'proof_of_life',
  ANONYMIZE = 'anonymize',
  HUMANITARIAN_VERIFICATION = 'humanitarian_verification',
  FRAUD_DETECTION = 'fraud_detection',
}

/**
 * Terminal states that indicate a job will not change further
 */
export const TERMINAL_JOB_STATES = [
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
];

/**
 * Core job status information
 * This is the minimal representation sent with each status update
 */
export class JobStatusDto {
  /**
   * Unique identifier for the job
   */
  id: string;

  /**
   * Type of job (OCR, inference, etc.)
   */
  type: JobType;

  /**
   * Current status of the job
   */
  status: JobStatus;

  /**
   * Progress percentage (0-100) for non-terminal states
   */
  progress?: number;

  /**
   * Timestamp when status was last updated
   */
  updatedAt: Date;

  /**
   * Timestamp when the job was created
   */
  createdAt: Date;
}

/**
 * Extended job status with result data
 * Sent when job reaches terminal state
 */
export class JobStatusWithResultDto extends JobStatusDto {
  /**
   * Result data when job completes successfully
   */
  result?: Record<string, unknown>;

  /**
   * Error message if job failed
   */
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };

  /**
   * Number of retry attempts made
   */
  attemptsMade?: number;

  /**
   * Maximum retry attempts allowed
   */
  maxRetries?: number;
}

/**
 * Job status event for pub/sub broadcasting
 * Includes metadata for routing and filtering
 */
export class JobStatusEvent {
  /**
   * Event ID for deduplication
   */
  eventId: string;

  /**
   * Job status information
   */
  job: JobStatusWithResultDto;

  /**
   * Optional user/context ID for filtering subscriptions
   */
  userId?: string;

  /**
   * Optional correlation ID for tracing
   */
  correlationId?: string;

  /**
   * Timestamp when event was emitted
   */
  emittedAt: Date;

  /**
   * Whether this is a terminal state update
   */
  isTerminal: boolean;

  /**
   * Optional metadata for contextualizing the job
   */
  metadata?: {
    campaignId?: string;
    claimId?: string;
    packageId?: string;
    [key: string]: unknown;
  };
}

/**
 * Subscription options for job status streams
 */
export interface JobStatusSubscriptionOptions {
  /**
   * Filter by job type(s)
   */
  jobTypes?: JobType[];

  /**
   * Filter by job status(es)
   */
  statuses?: JobStatus[];

  /**
   * Only receive terminal state updates
   */
  terminalOnly?: boolean;

  /**
   * Maximum duration to keep subscription active (ms)
   * Client should reconnect after this interval
   */
  maxDuration?: number;

  /**
   * Whether to receive missed updates on reconnect
   */
  sendMissedUpdates?: boolean;
}

/**
 * Subscription acknowledgment sent after client connects
 */
export class SubscriptionAckDto {
  /**
   * Unique subscription ID
   */
  subscriptionId: string;

  /**
   * Acknowledged options
   */
  options: JobStatusSubscriptionOptions;

  /**
   * Server timestamp for clock synchronization
   */
  serverTime: Date;

  /**
   * Recommended reconnect interval in milliseconds
   */
  recommendedReconnectInterval: number;

  /**
   * Number of missed updates since last connection
   */
  missedUpdatesCount?: number;

  /**
   * Missed updates if requested and available
   */
  missedUpdates?: JobStatusEvent[];
}
