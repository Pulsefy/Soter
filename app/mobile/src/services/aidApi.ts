import { apiGet, apiPost } from './requestLayer';

export interface AidItem {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'pending' | 'closed';
  location: string;
  createdAt: string;
}

export type ClaimStatus = 'requested' | 'verified' | 'approved' | 'disbursed';

export type ClaimTimelineStatus = 'verification' | 'approval' | 'claim' | 'disbursement';

export interface ClaimTimelineEvent {
  status: ClaimTimelineStatus;
  label?: string;
  timestamp?: string;
  transactionHash?: string;
  explorerUrl?: string;
}

export interface AidDetails {
  id: string;
  title: string;
  description: string;
  recipient: {
    name: string;
    id: string;
    wallet: string;
  };
  tokenType: string;
  amount: string;
  expiryDate: string;
  status: ClaimStatus;
  claimId: string;
  createdAt: string;
  verifiedAt?: string;
  approvedAt?: string;
  claimedAt?: string;
  disbursedAt?: string;
  verificationTransactionHash?: string;
  approvalTransactionHash?: string;
  claimTransactionHash?: string;
  disbursementTransactionHash?: string;
  timeline?: ClaimTimelineEvent[];
}

/** Fetch aid overview list from the backend */
export const fetchAidList = async (): Promise<AidItem[]> => {
  const { data } = await apiGet<AidItem[]>('/aid');
  return data;
};

/** Fetch detailed aid package info from the backend */
export const fetchAidDetails = async (aidId: string, correlationId?: string): Promise<AidDetails> => {
  const { data } = await apiGet<AidDetails>(`/aid/${aidId}`, { correlationId });
  return data;
};

/** Submit a claim to the backend with an idempotency key */
export const submitClaim = async (claimId: string, idempotencyKey: string, correlationId?: string): Promise<unknown> => {
  const { data } = await apiPost(`/claims/${claimId}/submit`, undefined, {
    idempotencyKey,
    correlationId,
  });
  return data;
};
