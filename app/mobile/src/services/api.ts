import { guardAgainstPinningFailure } from './certificatePinning';
import { structuredLogger } from './logger';
import { apiGet } from './requestLayer';

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
