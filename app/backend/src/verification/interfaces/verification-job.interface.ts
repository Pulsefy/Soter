import { ContractAwareMetadata } from '../dto/verification-result.dto';
import { VerificationPriority } from '../dto/enqueue-verification.dto';
import type { PartialResultInfo } from '../processing-budget';

export interface AnchorMetadata {
  campaignRef?: string | null;
  claimId?: string | null;
  packageId?: string | null;
  contractId?: string | null;
}

export interface VerificationJobData {
  claimId: string;
  timestamp: number;
  correlationId?: string;
  anchorMetadata?: AnchorMetadata;
  /**
   * Priority tier this job was submitted with.
   * Stored in the job payload so it is visible in logs and metrics even
   * after the job has been dequeued (BullMQ opts are not always accessible
   * during processing).
   */
  priority: VerificationPriority;
}

export interface VerificationResult {
  score: number;
  confidence: number;
  details: {
    factors: string[];
    riskLevel: 'low' | 'medium' | 'high';
    recommendations?: string[];
  };
  processedAt: Date;
  metadata?: ContractAwareMetadata;
  warnings?: string[];
  validationErrors?: string[];
  /**
   * Present only when the pipeline could not complete every step within the
   * per-claim processing budget.  When set, the claim must be flagged for
   * manual review and the incomplete steps must not be silently dropped.
   */
  partialResult?: PartialResultInfo;
}
