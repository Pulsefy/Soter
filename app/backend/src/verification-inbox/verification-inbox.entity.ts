export type VerificationStatus = 'pending' | 'approved' | 'rejected';

export class VerificationInboxItem {
  id: string;
  orgId: string;
  role: string;
  subject: string;
  description: string;
  status: VerificationStatus;
  requesterAddress: string;
  reviewerAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}