import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { HomeScreen } from '../screens/HomeScreen';
import { useWallet } from '../contexts/WalletContext';

jest.mock('../contexts/WalletContext', () => ({
  useWallet: jest.fn(),
}));

jest.spyOn(Alert, 'alert');

const mockUseWallet = useWallet as jest.Mock;

describe('HomeScreen', () => {
  const mockNavigation = {
    navigate: jest.fn(),
  } as any;

  const walletState = {
    connectWallet: jest.fn(),
    disconnectWallet: jest.fn(),
    error: null,
    lastDeepLinkUrl: null,
    pairingUri: null,
    publicKey: null,
    reopenWallet: jest.fn(),
    status: 'idle',
    walletName: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWallet.mockReturnValue(walletState);
  });

  it('renders correctly', () => {
    const { getByText } = render(<HomeScreen navigation={mockNavigation} />);
    expect(getByText('Soter')).toBeTruthy();
    expect(getByText('Powered by Stellar')).toBeTruthy();
    expect(getByText('Transparent aid, directly delivered.')).toBeTruthy();
    expect(getByText('Connect Wallet')).toBeTruthy();
    expect(getByText('View Aid Overview (Coming Soon)')).toBeTruthy();
    expect(getByText('View Aid Details (Coming Soon)')).toBeTruthy();
    expect(getByText(/Stellar network and Soroban smart contracts/)).toBeTruthy();
  });

  it('starts the wallet connection flow when connect wallet is pressed', () => {
    const { getByText } = render(<HomeScreen navigation={mockNavigation} />);

    fireEvent.press(getByText('Connect Wallet'));

    expect(walletState.connectWallet).toHaveBeenCalledTimes(1);
  });

  it('renders the connected public key when a wallet session exists', () => {
    mockUseWallet.mockReturnValue({
      ...walletState,
      publicKey: 'GABCD1234567890ABCDEFGH1234567890ABCDEFGH1234567890ABCDE',
      status: 'connected',
      walletName: 'Freighter',
    });

    const { getByText } = render(<HomeScreen navigation={mockNavigation} />);

    expect(getByText('Disconnect Wallet')).toBeTruthy();
    expect(getByText('Connected Public Key')).toBeTruthy();
    expect(getByText(/Freighter/)).toBeTruthy();
  });

  it('navigates to Health Screen when primary button is pressed', () => {
    const { getByText } = render(<HomeScreen navigation={mockNavigation} />);
    const button = getByText('Check Backend Health');

    fireEvent.press(button);
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Health');
  });

  it('shows an alert when placeholder buttons are pressed', () => {
    const { getByText } = render(<HomeScreen navigation={mockNavigation} />);

    fireEvent.press(getByText('View Aid Overview (Coming Soon)'));
    expect(Alert.alert).toHaveBeenCalledWith('Coming Soon', 'Coming in a future wave');

    fireEvent.press(getByText('View Aid Details (Coming Soon)'));
    expect(Alert.alert).toHaveBeenCalledTimes(2);
  });
});
