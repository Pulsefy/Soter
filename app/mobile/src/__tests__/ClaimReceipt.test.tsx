import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ClaimReceipt, type ClaimReceiptData } from '../components/ClaimReceipt';

const mockConfirmValueAction = jest.fn().mockResolvedValue(true);

jest.mock('../contexts/BiometricContext', () => ({
  useBiometric: () => ({
    biometricEnabled: false,
    authenticate: jest.fn().mockResolvedValue(true),
    confirmValueAction: mockConfirmValueAction,
  }),
}));

jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
jest.spyOn(Clipboard, 'setStringAsync').mockResolvedValue(undefined);

const claim: ClaimReceiptData = {
  claimId: 'claim-1',
  packageId: 'pkg-1',
  status: 'disbursed',
  amount: 500,
  timestamp: '2026-01-01T00:00:00.000Z',
  explorerLink: 'https://example.com/tx/1',
};

const colors = {
  background: '#fff',
  text: '#111',
  primary: '#00f',
  card: '#eee',
  border: '#ccc',
  success: '#0a0',
  warning: '#aa0',
  error: '#a00',
};

describe('ClaimReceipt value action confirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirmValueAction.mockResolvedValue(true);
  });

  it('shares after device confirmation succeeds', async () => {
    const { getByLabelText } = render(<ClaimReceipt claim={claim} colors={colors} />);

    fireEvent.press(getByLabelText(/Share claim receipt/i));

    await waitFor(() => {
      expect(mockConfirmValueAction).toHaveBeenCalledWith('Confirm receipt sharing');
    });
    expect(Share.share).toHaveBeenCalled();
  });

  it('aborts share when device confirmation is cancelled', async () => {
    mockConfirmValueAction.mockResolvedValue(false);
    const { getByLabelText } = render(<ClaimReceipt claim={claim} colors={colors} />);

    fireEvent.press(getByLabelText(/Share claim receipt/i));

    await waitFor(() => {
      expect(mockConfirmValueAction).toHaveBeenCalledWith('Confirm receipt sharing');
    });
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('copies full receipt text after device confirmation succeeds', async () => {
    const { getByLabelText } = render(<ClaimReceipt claim={claim} colors={colors} />);

    fireEvent.press(getByLabelText(/Copy full receipt text/i));

    await waitFor(() => {
      expect(mockConfirmValueAction).toHaveBeenCalledWith('Confirm receipt copy');
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalled();
  });
});
