/**
 * Component tests for screens (unit level)
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { AidOverviewScreen } from '../screens/AidOverviewScreen';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

jest.mock('../services/api', () => ({
  getAidPackages: jest.fn(),
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
  useSync: jest.fn().mockReturnValue({
    pendingCount: 0,
    failedCount: 0,
    isSyncing: false,
  }),
}));

import { getAidPackages } from '../services/api';
const mockGetAidPackages = getAidPackages as jest.Mock;

const Stack = createNativeStackNavigator<RootStackParamList>();

function Wrapper() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="AidOverview" component={AidOverviewScreen} />
        <Stack.Screen name="AidDetails" component={() => null} />
        <Stack.Screen name="Home" component={() => null} />
        <Stack.Screen name="Settings" component={() => null} />
        <Stack.Screen name="Health" component={() => null} />
        <Stack.Screen name="Scanner" component={() => null} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

describe('AidOverviewScreen', () => {
  beforeEach(() => mockGetAidPackages.mockReset());

  it('shows loading indicator initially', () => {
    mockGetAidPackages.mockReturnValue(new Promise(() => {})); // never resolves
    const { getByText } = render(<Wrapper />);
    expect(getByText(/Loading aid operations/i)).toBeTruthy();
  });

  it('renders aid packages after load', async () => {
    mockGetAidPackages.mockResolvedValueOnce([
      { id: 'aid-1', title: 'Food Aid', amount: 500, status: 'active', date: '2026-01-01' },
    ]);
    const { getByText } = render(<Wrapper />);
    await waitFor(() => expect(getByText(/Food Aid/i)).toBeTruthy());
  });

  it('shows empty state when no packages', async () => {
    mockGetAidPackages.mockResolvedValueOnce([]);
    const { getByText } = render(<Wrapper />);
    await waitFor(() => expect(getByText(/No aid operations found/i)).toBeTruthy());
  });

  it('falls back to cache on network error', async () => {
    const { loadCachedAidList } = require('../services/aidCache');
    loadCachedAidList.mockResolvedValueOnce([
      { id: 'cached-1', title: 'Cached Aid', amount: 100, status: 'active', date: '2026-01-01' },
    ]);
    mockGetAidPackages.mockRejectedValueOnce(new Error('Network error'));
    const { getByText } = render(<Wrapper />);
    await waitFor(() => expect(getByText(/Cached Aid/i)).toBeTruthy());
  });
});
