import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../theme/ThemeContext';
import { LanguageProvider } from '../contexts/LanguageContext';
import { BulkScannerScreen } from '../screens/BulkScannerScreen';
import { ClaimReceiptScreen } from '../screens/ClaimReceiptScreen';
import { ForceUpgradeScreen } from '../screens/ForceUpgradeScreen';
import { useCameraPermission } from '../hooks/useCameraPermission';
import { useSync } from '../contexts/SyncContext';
import { fetchClaimReceipt } from '../services/api';

jest.mock('../hooks/useCameraPermission', () => ({
  useCameraPermission: jest.fn(),
}));

jest.mock('../contexts/SyncContext', () => ({
  useSync: jest.fn(),
}));

jest.mock('../services/api', () => ({
  fetchClaimReceipt: jest.fn(),
  ReceiptApiError: class ReceiptApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ReceiptApiError';
    }
  },
}));

jest.mock('../contexts/BiometricContext', () => ({
  useBiometric: () => ({
    biometricEnabled: false,
    biometricSupported: false,
    toggleBiometric: jest.fn(),
    authenticate: jest.fn().mockResolvedValue(true),
    confirmValueAction: jest.fn().mockResolvedValue(true),
  }),
}));

jest.mock('../contexts/UpdateContext', () => ({
  useUpdate: () => ({
    versionInfo: {
      minRequiredVersion: '2.0.0',
      storeUrl: {
        ios: 'https://example.com/ios',
        android: 'https://example.com/android',
      },
    },
  }),
}));

const renderWithProviders = (ui: React.ReactElement) =>
  render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>,
  );

const mockUseCameraPermission = useCameraPermission as jest.Mock;
const mockUseSync = useSync as jest.Mock;
const mockFetchClaimReceipt = fetchClaimReceipt as jest.Mock;

describe('screen accessibility labels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCameraPermission.mockReturnValue({
      permissionState: 'granted',
      isGranted: true,
      isDenied: false,
      isBlocked: false,
      isChecking: false,
      requestPermission: jest.fn(),
      openSettings: jest.fn(),
      statusMessage: 'Camera permission granted',
    });
    mockUseSync.mockReturnValue({
      queueClaimConfirmation: jest.fn().mockResolvedValue({ status: 'completed' }),
      isConnected: true,
    });
    mockFetchClaimReceipt.mockResolvedValue({
      claimId: 'claim-123',
      packageId: 'package-123',
      status: 'approved',
      amount: 250,
      timestamp: '2026-10-17T09:00:00Z',
      recipientRef: 'ref-123',
    });
  });

  it('provides accessible controls and a logical button order on BulkScannerScreen', () => {
    renderWithProviders(<BulkScannerScreen navigation={{ goBack: jest.fn() } as any} />);

    const bulkButtons = screen.getAllByRole('button');
    expect(bulkButtons).toHaveLength(1);
    expect(bulkButtons[0].props.accessibilityLabel).toBe('End scanner session');
    expect(screen.getByRole('button', { name: 'End scanner session' })).toBeTruthy();
  });

  it('provides accessible controls and a logical button order on ClaimReceiptScreen', async () => {
    renderWithProviders(
      <ClaimReceiptScreen
        route={{ params: { packageId: 'package-123' } } as any}
        navigation={{ goBack: jest.fn() } as any}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Share claim receipt' })).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: 'Copy full receipt text' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();

    const order = screen.getAllByRole('button').map((button: any) => button.props.accessibilityLabel);
    expect(order).toEqual(['Share claim receipt', 'Copy full receipt text', 'Done']);
  });

  it('provides an accessible action on ForceUpgradeScreen', () => {
    renderWithProviders(<ForceUpgradeScreen />);

    expect(screen.getByRole('button', { name: 'Update Soter now' })).toBeTruthy();
  });
});
