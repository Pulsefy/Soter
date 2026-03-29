import { Platform } from 'react-native';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

export interface AidItem {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'pending' | 'closed';
  location: string;
  createdAt: string;
}

export type ClaimStatus = 'requested' | 'verified' | 'disbursed';

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
}

/** Fetch aid overview list from the backend */
export const fetchAidList = async (): Promise<AidItem[]> => {
  const response = await fetch(`${API_URL}/aid`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
};

/** Fetch detailed aid package info from the backend */
export const fetchAidDetails = async (aidId: string): Promise<AidDetails> => {
  const response = await fetch(`${API_URL}/aid/${aidId}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
};

/** Fallback mock data used when the backend is unreachable */
export const getMockAidList = (): AidItem[] => [
  {
    id: '1',
    title: 'Emergency Food Supply',
    description: 'Distribution of emergency food packages to affected families.',
    status: 'active',
    location: 'Sector A, Zone 3',
    createdAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Medical Aid Convoy',
    description: 'Mobile medical units providing first aid and triage.',
    status: 'active',
    location: 'Northern District',
    createdAt: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'Shelter Allocation',
    description: 'Temporary shelter setup for displaced residents.',
    status: 'pending',
    location: 'Central Camp',
    createdAt: new Date().toISOString(),
  },
];

/** Fallback mock detail data */
export const getMockAidDetails = (aidId: string): AidDetails => ({
  id: aidId,
  title: 'Emergency Food Supply',
  description: 'Distribution of emergency food packages to affected families.',
  recipient: {
    name: 'Amina Yusuf',
    id: 'REC-2041',
    wallet: 'GAKD...Q9X2',
  },
  tokenType: 'USDC',
  amount: '150',
  expiryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
  status: 'verified',
  claimId: `claim-${aidId}`,
  createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
});
