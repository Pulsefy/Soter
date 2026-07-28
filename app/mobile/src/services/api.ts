import { config } from '../config';

const API_URL = config.apiUrl;

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
    const response = await fetch(`${API_URL}/health`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch health status:', error);
    throw error;
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
    const response = await fetch(`${API_URL}/aid`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch aid packages:', error);
    throw error;
  }
};

export interface ClaimReceiptResponse {
  claimId: string;
  packageId: string;
  status: 'requested' | 'verified' | 'approved' | 'disbursed' | 'archived' | 'cancelled';
  amount: number;
  timestamp: string;
  tokenAddress?: string;
  recipientRef?: string;
}

export const fetchClaimReceipt = async (claimId: string): Promise<ClaimReceiptResponse> => {
  try {
    const response = await fetch(`${API_URL}/claims/${claimId}/receipt`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch claim receipt:', error);
    throw error;
  }
};
