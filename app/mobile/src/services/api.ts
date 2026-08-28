import { config } from '../config';
import { guardAgainstPinningFailure } from './certificatePinning';

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
  const url = `${API_URL}/health`;
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch health status:', error);
    return guardAgainstPinningFailure(url, error);
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
  const url = `${API_URL}/aid`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch aid packages:', error);
    return guardAgainstPinningFailure(url, error);
  }
};