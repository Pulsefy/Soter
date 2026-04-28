export interface VerificationJobData {
  claimId: string;
  timestamp: number;
  correlationId?: string;
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
