export interface VerificationJobData {
  claimId: string;
  timestamp: number;
  correlationId?: string;
}

export interface AnchorMetadata {
  campaign_ref?: string | null;
  claim_id?: string | null;
  package_id?: string | null;
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
  anchor_metadata?: AnchorMetadata | null;
}
