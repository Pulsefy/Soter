import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { NetworkGuardBanner } from '../components/NetworkGuardBanner';
import { useNetworkGuard } from '../hooks/useNetworkGuard';
import { useWallet } from '../contexts/WalletContext';
import { useAppTheme } from '../theme/useAppTheme';
import { NetworkMismatchErrorCode } from '../services/networkGuard';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../hooks/useNetworkGuard');
jest.mock('../contexts/WalletContext');
jest.mock('../theme/useAppTheme');
jest.mock('../i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'networkGuard.mainnetTitle': '⚠️ Mainnet Detected',
        'networkGuard.networkIssueTitle': '⚠️ Network Issue',
        'networkGuard.reconnectWallet': 'Reconnect Wallet',
        'networkGuard.reconnectWalletHint':
          'Disconnects the current session and opens WalletConnect so you can re-pair on the correct network',
        'networkGuard.switchNetwork': 'Switch Network',
        'networkGuard.switchNetworkHint': 'Opens your wallet to change the network setting',
        'networkGuard.dismiss': 'Dismiss',
        'networkGuard.dismissHint': 'Dismiss this network alert',
      };
      return map[key] ?? key;
    },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockColors = {
  error: '#CC0000',
  warning: '#FFAA00',
  background: '#FFFFFF',
  card: '#F5F5F5',
};

const mockRecoverSession = jest.fn();
const mockConnectWallet = jest.fn().mockResolvedValue(undefined);

function setupTheme() {
  (useAppTheme as jest.Mock).mockReturnValue({ colors: mockColors });
}

function setupWallet() {
  (useWallet as jest.Mock).mockReturnValue({
    recoverSession: mockRecoverSession,
    connectWallet: mockConnectWallet,
  });
}

function setupNoMismatch() {
  (useNetworkGuard as jest.Mock).mockReturnValue({
    isMismatch: false,
    errorMessage: null,
    remediationMessage: null,
    mismatchResult: null,
  });
}

function setupMismatch(errorCode: NetworkMismatchErrorCode) {
  (useNetworkGuard as jest.Mock).mockReturnValue({
    isMismatch: true,
    errorMessage: 'Wallet is connected to Mainnet. This requires Testnet.',
    remediationMessage: 'Please switch your wallet to Testnet.',
    mismatchResult: {
      isMismatch: true,
      error: {
        code: errorCode,
        message: 'Wallet is connected to Mainnet. This requires Testnet.',
        remediation: 'Please switch your wallet to Testnet.',
      },
      walletNetwork: { network: 'MAINNET', isTestnet: false, isMainnet: true, isKnown: true },
      requiredNetwork: 'TESTNET',
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NetworkGuardBanner (mobile)', () => {
  beforeEach(() => {
    setupTheme();
    setupWallet();
    jest.clearAllMocks();
  });

  it('renders nothing when there is no mismatch', () => {
    setupNoMismatch();
    const { toJSON } = render(<NetworkGuardBanner />);
    expect(toJSON()).toBeNull();
  });

  it('renders banner with error message when chain mismatch detected', () => {
    setupMismatch(NetworkMismatchErrorCode.CHAIN_MISMATCH);
    const { getByText } = render(<NetworkGuardBanner />);
    expect(getByText('⚠️ Network Issue')).toBeTruthy();
    expect(getByText('Wallet is connected to Mainnet. This requires Testnet.')).toBeTruthy();
  });

  it('renders "Mainnet Detected" title for WALLET_ON_MAINNET error', () => {
    setupMismatch(NetworkMismatchErrorCode.WALLET_ON_MAINNET);
    const { getByText } = render(<NetworkGuardBanner />);
    expect(getByText('⚠️ Mainnet Detected')).toBeTruthy();
  });

  it('shows Reconnect Wallet button for wallet-side network mismatches', () => {
    setupMismatch(NetworkMismatchErrorCode.WALLET_ON_MAINNET);
    const { getByText } = render(<NetworkGuardBanner />);
    expect(getByText('Reconnect Wallet')).toBeTruthy();
  });

  it('calls recoverSession and connectWallet when Reconnect Wallet is pressed', async () => {
    setupMismatch(NetworkMismatchErrorCode.WALLET_ON_MAINNET);
    const { getByText } = render(<NetworkGuardBanner />);

    await act(async () => {
      fireEvent.press(getByText('Reconnect Wallet'));
    });

    expect(mockRecoverSession).toHaveBeenCalledTimes(1);
    expect(mockConnectWallet).toHaveBeenCalledTimes(1);
  });

  it('shows Switch Network button when onSwitchNetwork is provided', () => {
    setupMismatch(NetworkMismatchErrorCode.CHAIN_MISMATCH);
    const onSwitchNetwork = jest.fn();
    const { getByText } = render(<NetworkGuardBanner onSwitchNetwork={onSwitchNetwork} />);
    expect(getByText('Switch Network')).toBeTruthy();
  });

  it('calls onSwitchNetwork when Switch Network button is pressed', () => {
    setupMismatch(NetworkMismatchErrorCode.CHAIN_MISMATCH);
    const onSwitchNetwork = jest.fn();
    const { getByText } = render(<NetworkGuardBanner onSwitchNetwork={onSwitchNetwork} />);
    fireEvent.press(getByText('Switch Network'));
    expect(onSwitchNetwork).toHaveBeenCalledTimes(1);
  });

  it('shows Dismiss button when onDismiss is provided', () => {
    setupMismatch(NetworkMismatchErrorCode.CHAIN_MISMATCH);
    const onDismiss = jest.fn();
    const { getByText } = render(<NetworkGuardBanner onDismiss={onDismiss} />);
    expect(getByText('Dismiss')).toBeTruthy();
  });

  it('calls onDismiss when Dismiss button is pressed', () => {
    setupMismatch(NetworkMismatchErrorCode.CHAIN_MISMATCH);
    const onDismiss = jest.fn();
    const { getByText } = render(<NetworkGuardBanner onDismiss={onDismiss} />);
    fireEvent.press(getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does NOT show Reconnect Wallet for NO_NETWORK_CONNECTION errors', () => {
    setupMismatch(NetworkMismatchErrorCode.NO_NETWORK_CONNECTION);
    const { queryByText } = render(<NetworkGuardBanner />);
    expect(queryByText('Reconnect Wallet')).toBeNull();
  });

  it('renders remediation message', () => {
    setupMismatch(NetworkMismatchErrorCode.CHAIN_MISMATCH);
    const { getByText } = render(<NetworkGuardBanner />);
    expect(getByText('Please switch your wallet to Testnet.')).toBeTruthy();
  });
});
