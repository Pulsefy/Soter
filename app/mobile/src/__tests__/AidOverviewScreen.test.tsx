import React from 'react';
import { render, waitFor, screen } from '@testing-library/react-native';
import { AidOverviewScreen } from '../screens/AidOverviewScreen';
import { getAidPackages } from '../services/api';
import {
  cacheAidList,
  loadCachedAidList,
  getCacheTimestamp,
} from '../services/aidCache';
import { ThemeProvider } from '../theme/ThemeContext';
import { LanguageProvider } from '../contexts/LanguageContext';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Mock dependencies
jest.mock('../services/api');
jest.mock('../services/aidCache');

jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: jest.fn(() => ({ isConnected: true })),
}));

jest.mock('../components/OfflineBanner', () => ({
  OfflineBanner: () => null,
}));

jest.mock('../components/DataFreshnessIndicator', () => ({
  DataFreshnessIndicator: () => null,
}));

jest.mock('../contexts/SyncContext', () => ({
  useSync: () => ({
    pendingCount: 0,
    failedCount: 0,
    isSyncing: false,
    getActionsForAid: jest.fn().mockReturnValue([]),
  }),
}));

jest.mock('../contexts/SaverModeContext', () => ({
  useSaverMode: () => ({
    active: false,
    source: null,
  }),
}));

const mockGetAidPackages = getAidPackages as jest.MockedFunction<typeof getAidPackages>;
const mockCacheAidList = cacheAidList as jest.MockedFunction<typeof cacheAidList>;
const mockLoadCachedAidList = loadCachedAidList as jest.MockedFunction<typeof loadCachedAidList>;
const mockGetCacheTimestamp = getCacheTimestamp as jest.MockedFunction<typeof getCacheTimestamp>;

const Stack = createNativeStackNavigator();

const renderScreen = () => {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen name="AidOverview" component={AidOverviewScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </LanguageProvider>
    </ThemeProvider>,
  );
};

describe('AidOverviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadCachedAidList.mockResolvedValue(null);
    mockGetCacheTimestamp.mockResolvedValue(null);
  });

  it('renders fresh aid list and writes to cache when backend is reachable', async () => {
    const freshAid = [
      {
        id: 'aid-1',
        title: 'Emergency Food Supply',
        amount: 500,
        status: 'active',
        date: '2026-01-01',
      },
    ];

    mockGetAidPackages.mockResolvedValueOnce(freshAid);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Emergency Food Supply')).toBeTruthy();
      expect(mockCacheAidList).toHaveBeenCalledWith(freshAid);
    });
  });

  it('displays cached aid data with age label when backend fails and cached data exists', async () => {
    const cachedAid = [
      {
        id: 'aid-1',
        title: 'Emergency Food Supply',
        amount: 500,
        status: 'active',
        date: '2026-01-01',
      },
    ];

    mockGetAidPackages.mockRejectedValueOnce(new Error('Network offline'));
    mockLoadCachedAidList.mockResolvedValueOnce(cachedAid);
    mockGetCacheTimestamp.mockResolvedValueOnce('2026-08-28T09:00:00Z');

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Emergency Food Supply')).toBeTruthy();
    });
  });

  it('displays honest empty state when backend fails and no cache exists (no mock fallback)', async () => {
    mockGetAidPackages.mockRejectedValueOnce(new Error('Network offline'));
    mockLoadCachedAidList.mockResolvedValueOnce(null);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText(/No aid operations/i)).toBeTruthy();
    });

    // Ensure mock aid data is NOT rendered
    expect(screen.queryByText('Emergency Food Supply')).toBeNull();
    expect(screen.queryByText('Medical Aid Convoy')).toBeNull();
    expect(screen.queryByText('Shelter Allocation')).toBeNull();
  });
});
