import { VerificationStatus } from '../verification-inbox.entity';

export class VerificationInboxItemDto {
  id: string;
  subject: string;
  description: string;
  status: VerificationStatus;
  requesterAddress: string;
  reviewerAddress?: string;
  createdAt: string;
  updatedAt: string;
}

export class VerificationInboxListDto {
  data: VerificationInboxItemDto[];
  total: number;
  limit: number;
  offset: number;
}