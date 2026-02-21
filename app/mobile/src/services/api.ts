import { Platform } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 
  (Platform.OS === 'android' 
    ? 'http://10.0.2.2:3000'  
    : 'http://localhost:3000'); 

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