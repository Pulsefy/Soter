export interface AnchorMetadata {
  campaignRef?: string | null;
  claimId?: string | null;
  packageId?: string | null;
}

export interface VerificationJobData {
  claimId: string;
  timestamp: number;
  correlationId?: string;
  anchorMetadata?: AnchorMetadata;
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
}
