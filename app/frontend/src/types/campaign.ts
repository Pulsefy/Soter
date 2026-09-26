export type CampaignStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';

export interface Campaign {
  id: string;
  name: string;
  budget: number;
  status: CampaignStatus;
  metadata?: {
    token?: string;
    expiry?: string;
    [key: string]: unknown;
  };
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
}

export interface CampaignCreatePayload {
  name: string;
  budget: number;
  status?: CampaignStatus;
  metadata?: {
    token?: string;
    expiry?: string;
    [key: string]: unknown;
  };
}

export interface CampaignUpdatePayload {
  name?: string;
  budget?: number;
  status?: CampaignStatus;
  metadata?: Record<string, unknown>;
}

export interface CampaignTimelineMilestone {
  id: string;
  label: string;
  status: 'completed' | 'pending' | 'delayed' | 'failed';
  occurredAt?: string;
  description: string;
  transactionHash?: string;
  explorerUrl?: string;
  correlationId?: string;
}
