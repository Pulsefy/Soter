import { guardAgainstPinningFailure } from './certificatePinning';
import { apiGet } from './requestLayer';
import { config } from '../config';

export interface ClaimReceiptData {
  claimId: string;
  packageId: string;
  status: 'requested' | 'verified' | 'approved' | 'disbursed' | 'archived' | 'cancelled';
  amount: number;
  tokenAddress?: string;
  transactionHash?: string;
  contractId?: string;
  timestamp: string;
  recipientRef?: string;
  explorerLink?: string;
  receiptPointer?: string;
}

export class ReceiptApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ReceiptApiError';
  }
}

export const fetchClaimReceipt = async (
  identifier: string,
): Promise<ClaimReceiptData> => {
  const response = await fetch(
    `${config.apiUrl}/claims/${encodeURIComponent(identifier)}/receipt`,
  );

  if (!response.ok) {
    let message = `Server responded with ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
    }
    throw new ReceiptApiError(response.status, message);
  }

  return (await response.json()) as ClaimReceiptData;
};

export interface HealthStatus {
  status: string;
  service: string;
  version: string;
  environment: string;
  timestamp: string;
  mocked?: boolean;
}

export const fetchHealthStatus = async (): Promise<HealthStatus> => {
  try {
    const { data } = await apiGet<HealthStatus>('/health');
    return data;
  } catch (error) {
    return guardAgainstPinningFailure(`${process.env.API_URL}/health`, error);
  }
};

export interface AidPackage {
  id: string;
  title: string;
  amount: number;
  status: string;
  date: string;
}

export const getAidPackages = async (): Promise<AidPackage[]> => {
  try {
    const { data } = await apiGet<AidPackage[]>('/aid');
    return data;
  } catch (error) {
    return guardAgainstPinningFailure(`${process.env.API_URL}/aid`, error);
  }
};
