export type ReviewCaseStatus = 'pending' | 'approved' | 'rejected';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface ReviewCaseClaim {
  id: string;
  status: string;
  amount: number;
  recipientRef: string;
  evidenceRef: string | null;
  createdAt: string;
  campaign: {
    id: string;
    name: string;
  };
}

export interface ReviewCase {
  id: string;
  claimId: string;
  status: ReviewCaseStatus;
  aiScore: number;
  confidence: number;
  riskLevel: RiskLevel;
  factors: string[] | null;
  recommendations: string[] | null;
  evidenceSummary: string | null;
  reviewerId: string | null;
  reviewerNotes: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  claim: ReviewCaseClaim;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  entity: string;
  entityId: string;
  action: string;
  timestamp: string;
  metadata: unknown;
}

export interface ReviewCaseDetail extends ReviewCase {
  history: AuditLogEntry[];
}

export interface ReviewQueueResponse {
  items: ReviewCase[];
  total: number;
  page: number;
  limit: number;
}

export interface ReviewQueueFilters {
  status?: ReviewCaseStatus | '';
  riskLevel?: RiskLevel | '';
  fromDate?: string;
  toDate?: string;
}
