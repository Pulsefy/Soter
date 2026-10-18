/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { NetworkMismatchBanner } from '../NetworkMismatchBanner';
import * as networkGuard from '@/hooks/useNetworkGuard';
import * as walletStore from '@/lib/walletStore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/hooks/useNetworkGuard');
jest.mock('@/lib/walletStore');
jest.mock('next-intl', () => ({
  useTranslations:
    () => (key: string, params?: Record<string, string>) => {
      const map: Record<string, string> = {
        'wallet.networkMismatch': `Network mismatch — your wallet is on ${params?.walletNetwork} but this app requires ${params?.expectedNetwork}. Open Freighter and switch to the correct network to continue.`,
        'wallet.refreshSession': 'I switched — refresh',
        'wallet.refreshingSession': 'Refreshing…',
        'wallet.refreshSessionLabel': 'Re-read network from Freighter after switching',
        'wallet.disconnectAndReconnect': 'Disconnect & reconnect',
        'wallet.disconnectToReconnectLabel':
          'Disconnect wallet so you can reconnect on the correct network',
      };
      return map[key] ?? key;
    },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockRefreshNetwork = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn();

function setupMismatch(overrides: Partial<ReturnType<typeof networkGuard.useNetworkGuard>> = {}) {
  jest.spyOn(networkGuard, 'useNetworkGuard').mockReturnValue({
    isCorrectNetwork: false,
    isMismatch: true,
    walletNetwork: 'mainnet',
    expectedNetwork: 'testnet',
    refreshNetwork: mockRefreshNetwork,
    ...overrides,
  });

  jest.spyOn(walletStore, 'useWalletStore').mockReturnValue({
    publicKey: 'GABC',
    network: 'mainnet',
    setPublicKey: jest.fn(),
    setNetwork: jest.fn(),
    disconnect: mockDisconnect,
  } as unknown as ReturnType<typeof walletStore.useWalletStore>);
}

function setupNoMismatch() {
  jest.spyOn(networkGuard, 'useNetworkGuard').mockReturnValue({
    isCorrectNetwork: true,
    isMismatch: false,
    walletNetwork: 'testnet',
    expectedNetwork: 'testnet',
    refreshNetwork: mockRefreshNetwork,
  });

  jest.spyOn(walletStore, 'useWalletStore').mockReturnValue({
    publicKey: 'GABC',
    network: 'testnet',
    setPublicKey: jest.fn(),
    setNetwork: jest.fn(),
    disconnect: mockDisconnect,
  } as unknown as ReturnType<typeof walletStore.useWalletStore>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NetworkMismatchBanner', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when there is no mismatch', () => {
    setupNoMismatch();
    const { container } = render(<NetworkMismatchBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the banner with wallet and expected network when mismatched', () => {
    setupMismatch();
    render(<NetworkMismatchBanner />);
    expect(screen.getByText(/MAINNET/)).toBeInTheDocument();
    expect(screen.getByText(/TESTNET/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('has aria-live assertive for screen readers', () => {
    setupMismatch();
    render(<NetworkMismatchBanner />);
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('renders nothing when wallet is not connected (isMismatch=false)', () => {
    jest.spyOn(networkGuard, 'useNetworkGuard').mockReturnValue({
      isCorrectNetwork: false,
      isMismatch: false,
      walletNetwork: null,
      expectedNetwork: 'testnet',
      refreshNetwork: mockRefreshNetwork,
    });
    jest.spyOn(walletStore, 'useWalletStore').mockReturnValue({
      publicKey: null,
      network: null,
      setPublicKey: jest.fn(),
      setNetwork: jest.fn(),
      disconnect: mockDisconnect,
    } as unknown as ReturnType<typeof walletStore.useWalletStore>);

    const { container } = render(<NetworkMismatchBanner />);
    expect(container.firstChild).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Action buttons
  // -----------------------------------------------------------------------

  it('shows "I switched — refresh" and "Disconnect & reconnect" action buttons', () => {
    setupMismatch();
    render(<NetworkMismatchBanner />);
    expect(screen.getByText('I switched — refresh')).toBeInTheDocument();
    expect(screen.getByText('Disconnect & reconnect')).toBeInTheDocument();
  });

  it('calls refreshNetwork when the refresh button is clicked', async () => {
    setupMismatch();
    render(<NetworkMismatchBanner />);

    const refreshButton = screen.getByText('I switched — refresh');
    await act(async () => {
      fireEvent.click(refreshButton);
    });

    expect(mockRefreshNetwork).toHaveBeenCalledTimes(1);
  });

  it('shows loading state while refreshing and re-enables after completion', async () => {
    // Make refreshNetwork take a tick to resolve
    let resolveRefresh!: () => void;
    const slowRefresh = jest.fn(
      () => new Promise<void>((res) => { resolveRefresh = res; }),
    );
    setupMismatch({ refreshNetwork: slowRefresh });

    render(<NetworkMismatchBanner />);

    const refreshButton = screen.getByText('I switched — refresh');
    fireEvent.click(refreshButton);

    // While pending the button should show the loading label and be disabled
    await waitFor(() =>
      expect(screen.getByText('Refreshing…')).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /re-read network/i }),
    ).toBeDisabled();

    // Resolve the promise
    await act(async () => { resolveRefresh(); });

    // After resolution the button should revert to normal
    await waitFor(() =>
      expect(screen.getByText('I switched — refresh')).toBeInTheDocument(),
    );
  });

  it('calls wallet disconnect when "Disconnect & reconnect" is clicked', () => {
    setupMismatch();
    render(<NetworkMismatchBanner />);

    const disconnectButton = screen.getByText('Disconnect & reconnect');
    fireEvent.click(disconnectButton);

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('has accessible labels on both action buttons', () => {
    setupMismatch();
    render(<NetworkMismatchBanner />);

    expect(
      screen.getByRole('button', { name: /re-read network from freighter/i }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: /disconnect wallet so you can reconnect/i }),
    ).toBeInTheDocument();
  });
});
