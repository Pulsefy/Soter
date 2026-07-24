import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { HomeScreen } from '../screens/HomeScreen';
import { useWallet } from '../contexts/WalletContext';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => {
    const { Colors, SoterLightTheme } = require('../theme/theme');

    return {
      colors: { ...Colors.light, brand: Colors.brand },
      navTheme: SoterLightTheme,
      scheme: 'light',
    };
  },
}));

jest.mock('../contexts/WalletContext', () => ({
  useWallet: jest.fn(),
}));

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
    const { getByText, getByLabelText } = render(<HomeScreen navigation={mockNavigation} />);
    expect(getByText('Soter')).toBeTruthy();
    expect(getByLabelText('Powered by Stellar')).toBeTruthy();
    expect(getByText('Transparent aid, directly delivered.')).toBeTruthy();
    expect(getByLabelText('Connect Wallet')).toBeTruthy();
    expect(getByLabelText('Check Backend Health')).toBeTruthy();
    expect(getByLabelText('View Operator Task List')).toBeTruthy();
    expect(getByLabelText('View Aid Details')).toBeTruthy();
    expect(getByText(/Transparent aid, directly delivered/)).toBeTruthy();
  });

  it('starts the wallet connection flow when connect wallet is pressed', () => {
    const { getByText } = render(<HomeScreen navigation={mockNavigation} />);

    fireEvent.press(getByText('Connect Wallet'));

    expect(walletState.connectWallet).toHaveBeenCalledTimes(1);
  });

  it('shows a reconnect action when the wallet session needs recovery', () => {
    mockUseWallet.mockReturnValue({
      ...walletState,
      error: 'The stored WalletConnect session is expired. Reconnect to continue.',
      status: 'error',
    });

    const { getByText } = render(<HomeScreen navigation={mockNavigation} />);

    expect(getByText('Reconnect Wallet')).toBeTruthy();
  });

  it('renders the connected public key when a wallet session exists', () => {
    mockUseWallet.mockReturnValue({
      ...walletState,
      publicKey: 'GABCD1234567890ABCDEFGH1234567890ABCDEFGH1234567890ABCDE',
      status: 'connected',
      walletName: 'Freighter',
    });

    const { getByText, getByLabelText } = render(<HomeScreen navigation={mockNavigation} />);

    expect(getByLabelText('Disconnect Wallet')).toBeTruthy();
    expect(getByLabelText('Connected public key: GABCD1234567890ABCDEFGH1234567890ABCDEFGH1234567890ABCDE. Active wallet: Freighter')).toBeTruthy();
    // Wallet identity verified via accessibility label above
  });

  it('navigates to Health Screen when primary button is pressed', () => {
    const { getByText } = render(<HomeScreen navigation={mockNavigation} />);
    const button = getByText('Check Backend Health');

    fireEvent.press(button);
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Health');
  });

  it('navigates to the aid details screen when that button is pressed', () => {
    const { getByText } = render(<HomeScreen navigation={mockNavigation} />);

    fireEvent.press(getByText('View Aid Details'));

    expect(mockNavigation.navigate).toHaveBeenCalledWith('AidDetails', { aidId: '1' });
  });
});
