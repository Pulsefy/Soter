import React from 'react';
import { render, waitFor, screen, fireEvent } from '@testing-library/react-native';
import { AidDetailsScreen } from '../screens/AidDetailsScreen';
import { fetchAidDetails, AidDetails } from '../services/aidApi';
import {
  cacheAidDetails,
  loadCachedAidDetails,
  getAidDetailsCacheTimestamp,
} from '../services/aidCache';
import { ThemeProvider } from '../theme/ThemeContext';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Mock dependencies
jest.mock('../services/aidApi');
jest.mock('../services/aidCache');

jest.mock('../contexts/BiometricContext', () => ({
  useBiometric: () => ({
    biometricEnabled: false,
    authenticate: jest.fn().mockResolvedValue(true),
    confirmValueAction: jest.fn().mockResolvedValue(true),
  }),
}));

jest.mock('../contexts/SaverModeContext', () => ({
  useSaverMode: () => ({
    active: false,
    source: null,
  }),
}));

jest.mock('../contexts/SyncContext', () => ({
  useSync: () => ({
    getActionsForAid: jest.fn().mockReturnValue([]),
    isConnected: true,
    isSyncing: false,
    lastCompletedAction: null,
    queueClaimConfirmation: jest.fn(),
    queueStatusRefresh: jest.fn(),
  }),
}));

const mockFetchAidDetails = fetchAidDetails as jest.MockedFunction<typeof fetchAidDetails>;
const mockCacheAidDetails = cacheAidDetails as jest.MockedFunction<typeof cacheAidDetails>;
const mockLoadCachedAidDetails = loadCachedAidDetails as jest.MockedFunction<typeof loadCachedAidDetails>;
const mockGetAidDetailsCacheTimestamp = getAidDetailsCacheTimestamp as jest.MockedFunction<typeof getAidDetailsCacheTimestamp>;

const sampleAidDetails: AidDetails = {
  id: 'aid-101',
  title: 'Clean Water Initiative',
  description: 'Water filtration kits for families.',
  recipient: {
    name: 'Fatima Zahra',
    id: 'REC-9081',
    wallet: 'GBXY...9911',
  },
  tokenType: 'USDC',
  amount: '300',
  expiryDate: '2026-12-31T00:00:00Z',
  status: 'verified',
  claimId: 'claim-aid-101',
  createdAt: '2026-08-01T00:00:00Z',
  verifiedAt: '2026-08-02T00:00:00Z',
  approvalTransactionHash: 'c'.repeat(64),
};

const Stack = createNativeStackNavigator();

const renderScreen = (aidId = 'aid-101') => {
  return render(
    <ThemeProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="AidDetails"
            component={AidDetailsScreen}
            initialParams={{ aidId }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>,
  );
};

describe('AidDetailsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadCachedAidDetails.mockResolvedValue(null);
    mockGetAidDetailsCacheTimestamp.mockResolvedValue(null);
  });

  it('renders fresh aid details and writes to cache when backend is reachable', async () => {
    mockFetchAidDetails.mockResolvedValueOnce(sampleAidDetails);

    renderScreen('aid-101');

    await waitFor(() => {
      expect(screen.getByText('Clean Water Initiative')).toBeTruthy();
      expect(screen.getByText('Package ID: aid-101')).toBeTruthy();
      expect(screen.getByText('Fatima Zahra', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('300 USDC', { includeHiddenElements: true })).toBeTruthy();
      expect(mockCacheAidDetails).toHaveBeenCalledWith('aid-101', sampleAidDetails);
    });
  });

  it('displays cached aid data with age label when backend fails and cached data exists', async () => {
    mockFetchAidDetails.mockRejectedValueOnce(new Error('Network offline'));
    mockLoadCachedAidDetails.mockResolvedValueOnce(sampleAidDetails);
    mockGetAidDetailsCacheTimestamp.mockResolvedValueOnce('2026-08-28T09:00:00Z');

    renderScreen('aid-101');

    await waitFor(() => {
      expect(screen.getByText('Clean Water Initiative')).toBeTruthy();
      expect(
        screen.getByText('Unable to reach the server. Showing last known cached data.'),
      ).toBeTruthy();
      expect(screen.getByText('Fatima Zahra', { includeHiddenElements: true })).toBeTruthy();
    });
  });

  it('displays honest unavailable state when backend fails and no cache exists', async () => {
    mockFetchAidDetails.mockRejectedValueOnce(new Error('Network offline'));
    mockLoadCachedAidDetails.mockResolvedValueOnce(null);

    renderScreen('aid-101');

    await waitFor(() => {
      expect(screen.getByText('Aid Details Unavailable')).toBeTruthy();
      expect(
        screen.getByText('Unable to reach the server. Aid details are unavailable offline.'),
      ).toBeTruthy();
      expect(screen.getByText('🔄 Retry Connection')).toBeTruthy();
      expect(screen.getByText('Back to Aid Overview')).toBeTruthy();
      // Ensure mock fake recipient Amina Yusuf is NOT rendered
      expect(screen.queryByText('Amina Yusuf', { includeHiddenElements: true })).toBeNull();
      expect(screen.queryByText('Emergency Food Supply')).toBeNull();
    });
  });

  it('retries fetching aid details when retry button is pressed on unavailable screen', async () => {
    mockFetchAidDetails.mockRejectedValueOnce(new Error('Network offline'));
    mockLoadCachedAidDetails.mockResolvedValueOnce(null);

    renderScreen('aid-101');

    await waitFor(() => {
      expect(screen.getByText('Aid Details Unavailable')).toBeTruthy();
    });

    mockFetchAidDetails.mockResolvedValueOnce(sampleAidDetails);

    const retryButton = screen.getByText('🔄 Retry Connection');
    fireEvent.press(retryButton);

    await waitFor(() => {
      expect(screen.getByText('Clean Water Initiative')).toBeTruthy();
      expect(screen.getByText('Fatima Zahra', { includeHiddenElements: true })).toBeTruthy();
    });
  });
});
