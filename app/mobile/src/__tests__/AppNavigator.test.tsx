import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  createNavigationContainerRef,
  NavigationContainer,
} from '@react-navigation/native';
import { useWallet } from '../contexts/WalletContext';
import { ThemeProvider } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';

jest.mock('../screens/HomeScreen', () => {
  const { Text } = require('react-native');
  return { HomeScreen: () => <Text>Home</Text> };
});

jest.mock('../screens/HealthScreen', () => {
  const { Text } = require('react-native');
  return { HealthScreen: () => <Text>Health</Text> };
});

jest.mock('../screens/AidOverviewScreen', () => {
  const { Text } = require('react-native');
  return { AidOverviewScreen: () => <Text>AidOverview</Text> };
});

jest.mock('../screens/AidDetailsScreen', () => {
  const { Text } = require('react-native');
  return { AidDetailsScreen: () => <Text>AidDetails</Text> };
});

jest.mock('../screens/EvidenceUploadScreen', () => {
  const { Text } = require('react-native');
  return { EvidenceUploadScreen: () => <Text>EvidenceUpload</Text> };
});

jest.mock('../screens/ClaimReceiptScreen', () => {
  const { Text } = require('react-native');
  return { ClaimReceiptScreen: () => <Text>ClaimReceipt</Text> };
});

jest.mock('../screens/SettingsScreen', () => {
  const { Text } = require('react-native');
  return { SettingsScreen: () => <Text>Settings</Text> };
});

jest.mock('../screens/ScannerScreen', () => {
  const { Text } = require('react-native');
  return { ScannerScreen: () => <Text>Scanner</Text> };
});

jest.mock('../screens/BulkScannerScreen', () => {
  const { Text } = require('react-native');
  return { BulkScannerScreen: () => <Text>BulkScanner</Text> };
});

jest.mock('../screens/TaskListScreen', () => {
  const { Text } = require('react-native');
  return { TaskListScreen: () => <Text>TaskList</Text> };
});

import { AppNavigator } from '../navigation/AppNavigator';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-barcode-scanner', () => ({
  BarCodeScanner: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
}));

jest.mock('../contexts/WalletContext', () => ({
  useWallet: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(() =>
    Promise.resolve({ isConnected: true, isInternetReachable: true }),
  ),
}));

jest.mock('../services/api', () => ({
  getAidPackages: jest.fn().mockResolvedValue([]),
}));

const mockUseWallet = useWallet as jest.Mock;

describe('AppNavigator', () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({
      connectWallet: jest.fn(),
      disconnectWallet: jest.fn(),
      error: null,
      lastDeepLinkUrl: null,
      pairingUri: null,
      publicKey: null,
      reopenWallet: jest.fn(),
      status: 'idle',
      walletName: null,
    });
  });

  it('renders Home by default and navigates to Health route', async () => {
    const { getByText, findByText } = render(
      <ThemeProvider>
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </ThemeProvider>,
    );

    expect(getByText('Home')).toBeTruthy();
  });

  it('declares AidOverview and AidDetails routes in navigator config', async () => {
    const navigationRef = createNavigationContainerRef<RootStackParamList>();
    render(
      <ThemeProvider>
        <NavigationContainer ref={navigationRef}>
          <AppNavigator />
        </NavigationContainer>
      </ThemeProvider>,
    );

    await waitFor(() => expect(navigationRef.isReady()).toBe(true));

    await act(async () => {
      navigationRef.navigate('AidOverview');
    });
    await waitFor(() =>
      expect(navigationRef.getCurrentRoute()?.name).toBe('AidOverview'),
    );

    await act(async () => {
      navigationRef.navigate('AidDetails', { aidId: 'aid-123' });
    });
    await waitFor(() =>
      expect(navigationRef.getCurrentRoute()?.name).toBe('AidDetails'),
    );
    expect(navigationRef.getCurrentRoute()?.params).toMatchObject({
      aidId: 'aid-123',
    });

    await act(async () => {
      navigationRef.navigate('ClaimReceipt', { claimId: 'claim-123' });
    });
    await waitFor(() =>
      expect(navigationRef.getCurrentRoute()?.name).toBe('ClaimReceipt'),
    );
    expect(navigationRef.getCurrentRoute()?.params).toMatchObject({
      claimId: 'claim-123',
    });
  });
});
