export type VerificationStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'needs_resubmission';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface VerificationInboxItem {
  id: string;
  status: VerificationStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  nextStepMessage: string | null;
  deepLink: string;
  // AI scoring fields (present when available)
  aiScore?: number | null;
  riskLevel?: RiskLevel | null;
  documentType?: string | null;
}

export interface VerificationInboxResponse {
  items: VerificationInboxItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface VerificationStats {
  pending_review: number;
  approved: number;
  rejected: number;
  needs_resubmission: number;
  total: number;
}

export interface InternalNote {
  id: string;
  entityType: string;
  entityId: string;
  content: string;
  authorId: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewFilters {
  status: VerificationStatus | '';
  riskLevel: RiskLevel | '';
  dateFrom: string;
  dateTo: string;
  page: number;
}
