/**
 * Integration tests: navigation flow Home -> AidOverview -> AidDetails
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../screens/HomeScreen';
import { AidOverviewScreen } from '../screens/AidOverviewScreen';
import { AidDetailsScreen } from '../screens/AidDetailsScreen';
import type { RootStackParamList } from '../navigation/types';

// Mock heavy dependencies
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({
    connectWallet: jest.fn(),
    disconnectWallet: jest.fn(),
    error: null,
    lastDeepLinkUrl: null,
    pairingUri: null,
    publicKey: null,
    reopenWallet: jest.fn(),
    status: 'idle',
    walletName: null,
  }),
}));

jest.mock('../contexts/BiometricContext', () => ({
  useBiometric: () => ({ biometricEnabled: false, authenticate: jest.fn().mockResolvedValue(true) }),
}));

jest.mock('../services/api', () => ({
  getAidPackages: jest.fn().mockResolvedValue([
    { id: 'aid-1', title: 'Food Aid', amount: 500, status: 'active', date: '2026-01-01' },
    { id: 'aid-2', title: 'Medical Aid', amount: 1200, status: 'pending', date: '2026-01-02' },
  ]),
}));

jest.mock('../services/aidApi', () => ({
  fetchAidDetails: jest.fn().mockResolvedValue({
    id: 'aid-1',
    title: 'Food Aid',
    description: 'Emergency food packages',
    recipient: {
      name: 'Amina Yusuf',
      id: 'REC-2041',
      wallet: 'GAKD...Q9X2',
    },
    tokenType: 'USDC',
    amount: '500',
    expiryDate: '2026-01-10T00:00:00Z',
    status: 'verified',
    claimId: 'claim-aid-1',
    createdAt: '2026-01-01T00:00:00Z',
  }),
  getMockAidDetails: jest.fn(),
}));

jest.mock('../services/aidCache', () => ({
  cacheAidList: jest.fn(),
  loadCachedAidList: jest.fn().mockResolvedValue([]),
  getCacheTimestamp: jest.fn().mockResolvedValue(null),
}));

jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: jest.fn().mockReturnValue({ isConnected: true }),
}));

jest.mock('../components/OfflineBanner', () => ({
  OfflineBanner: () => null,
}));

jest.mock('../contexts/SyncContext', () => ({
  useSync: () => ({
    items: [],
    isSyncing: false,
    lastSyncAt: null,
    lastSyncError: null,
    isConnected: true,
    pendingCount: 0,
    failedCount: 0,
    lastCompletedAction: null,
    flushNow: jest.fn(),
    queueStatusRefresh: jest.fn(),
    queueClaimConfirmation: jest.fn(),
    queueEvidenceUpload: jest.fn(),
    getActionsForAid: jest.fn().mockReturnValue([]),
  }),
}));

const Stack = createNativeStackNavigator<RootStackParamList>();

function TestNavigator({ initialRoute = 'Home' }: { initialRoute?: keyof RootStackParamList }) {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName={initialRoute as any}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="AidOverview" component={AidOverviewScreen} />
        <Stack.Screen name="AidDetails" component={AidDetailsScreen} />
        <Stack.Screen name="Settings" component={() => null} />
        <Stack.Screen name="Health" component={() => null} />
        <Stack.Screen name="Scanner" component={() => null} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

describe('Navigation: Home -> AidOverview -> AidDetails', () => {
  it('renders HomeScreen with title', async () => {
    const { getByText } = render(<TestNavigator initialRoute="Home" />);
    await waitFor(() => {
      expect(getByText('Soter')).toBeTruthy();
    });
  });

  it('renders AidOverviewScreen and shows aid list', async () => {
    const { getByText } = render(<TestNavigator initialRoute="AidOverview" />);
    await waitFor(() => {
      expect(getByText(/Food Aid/i)).toBeTruthy();
    });
  });

  it('navigates from AidOverview to AidDetails on card press', async () => {
    const { getByText } = render(<TestNavigator initialRoute="AidOverview" />);
    await waitFor(() => expect(getByText(/Food Aid/i)).toBeTruthy());
    fireEvent.press(getByText(/Food Aid/i));
    await waitFor(() => {
      expect(getByText(/aid-1/i)).toBeTruthy();
    });
  });
});
