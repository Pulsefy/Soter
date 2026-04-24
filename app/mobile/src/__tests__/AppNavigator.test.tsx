import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from '../navigation/AppNavigator';
import { useWallet } from '../contexts/WalletContext';
import type { RootStackParamList } from '../navigation/types';
import { ThemeProvider } from '../theme/ThemeContext';

jest.mock('../contexts/WalletContext', () => ({
  useWallet: jest.fn(),
}));

jest.mock('../contexts/BiometricContext', () => ({
  useBiometric: () => ({ biometricEnabled: false, authenticate: jest.fn().mockResolvedValue(true) }),
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
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

    expect(getByText('Soter')).toBeTruthy();
    expect(getByText('Check Backend Health')).toBeTruthy();
    expect(getByText('View Aid Overview (Coming Soon)')).toBeTruthy();

    fireEvent.press(getByText('Check Backend Health'));
    expect(await findByText('Checking system health...')).toBeTruthy();
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
    expect(navigationRef.getCurrentRoute()?.params).toMatchObject({ aidId: 'aid-123' });
  });
});
