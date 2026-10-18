/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { useWalletStore } from '@/lib/walletStore';
import { useNetworkGuard } from '../useNetworkGuard';

// ---------------------------------------------------------------------------
// Mock env so EXPECTED_NETWORK is deterministic in tests
// ---------------------------------------------------------------------------
jest.mock('@/lib/env', () => ({
  EXPECTED_NETWORK: 'testnet',
  stellarNetwork: 'testnet',
}));

// ---------------------------------------------------------------------------
// Mock Freighter API so refreshNetwork doesn't make real calls
// ---------------------------------------------------------------------------
jest.mock('@stellar/freighter-api', () => ({
  getNetworkDetails: jest.fn(),
}));

import { getNetworkDetails } from '@stellar/freighter-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setWallet(publicKey: string | null, network: string | null) {
  act(() => {
    useWalletStore.setState({ publicKey, network });
  });
}

afterEach(() => {
  setWallet(null, null);
  jest.clearAllMocks();
  jest.clearAllTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useNetworkGuard', () => {
  it('returns no mismatch when wallet is not connected', () => {
    setWallet(null, null);
    const { result } = renderHook(() => useNetworkGuard());
    expect(result.current.isMismatch).toBe(false);
    expect(result.current.isCorrectNetwork).toBe(false);
  });

  it('returns isCorrectNetwork=true when wallet is on expected network', () => {
    setWallet('GABC', 'testnet');
    const { result } = renderHook(() => useNetworkGuard());
    expect(result.current.isCorrectNetwork).toBe(true);
    expect(result.current.isMismatch).toBe(false);
  });

  it('is case-insensitive when comparing networks', () => {
    setWallet('GABC', 'TESTNET');
    const { result } = renderHook(() => useNetworkGuard());
    expect(result.current.isCorrectNetwork).toBe(true);
    expect(result.current.isMismatch).toBe(false);
  });

  it('detects mismatch when wallet is on a different network', () => {
    setWallet('GABC', 'mainnet');
    const { result } = renderHook(() => useNetworkGuard());
    expect(result.current.isMismatch).toBe(true);
    expect(result.current.isCorrectNetwork).toBe(false);
    expect(result.current.walletNetwork).toBe('mainnet');
    expect(result.current.expectedNetwork).toBe('testnet');
  });

  it('recovers when wallet switches to the correct network', () => {
    setWallet('GABC', 'mainnet');
    const { result } = renderHook(() => useNetworkGuard());
    expect(result.current.isMismatch).toBe(true);

    act(() => {
      useWalletStore.setState({ network: 'testnet' });
    });
    expect(result.current.isMismatch).toBe(false);
    expect(result.current.isCorrectNetwork).toBe(true);
  });

  // -----------------------------------------------------------------------
  // refreshNetwork
  // -----------------------------------------------------------------------

  it('exposes a refreshNetwork function', () => {
    setWallet('GABC', 'testnet');
    const { result } = renderHook(() => useNetworkGuard());
    expect(typeof result.current.refreshNetwork).toBe('function');
  });

  it('refreshNetwork calls getNetworkDetails and updates the store', async () => {
    (getNetworkDetails as jest.Mock).mockResolvedValue({ network: 'testnet' });
    setWallet('GABC', 'mainnet');

    const { result } = renderHook(() => useNetworkGuard());
    expect(result.current.isMismatch).toBe(true);

    await act(async () => {
      await result.current.refreshNetwork();
    });

    expect(getNetworkDetails).toHaveBeenCalledTimes(1);
    // Store should now have testnet
    expect(useWalletStore.getState().network).toBe('testnet');
  });

  it('refreshNetwork is a no-op when wallet is not connected', async () => {
    (getNetworkDetails as jest.Mock).mockResolvedValue({ network: 'testnet' });
    setWallet(null, null);

    const { result } = renderHook(() => useNetworkGuard());
    await act(async () => {
      await result.current.refreshNetwork();
    });

    expect(getNetworkDetails).not.toHaveBeenCalled();
  });

  it('refreshNetwork silently swallows errors from Freighter', async () => {
    (getNetworkDetails as jest.Mock).mockRejectedValue(new Error('Freighter unavailable'));
    setWallet('GABC', 'mainnet');

    const { result } = renderHook(() => useNetworkGuard());

    await expect(
      act(async () => {
        await result.current.refreshNetwork();
      }),
    ).resolves.not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Accelerated polling while mismatched
  // -----------------------------------------------------------------------

  it('starts accelerated polling when isMismatch is true', () => {
    jest.useFakeTimers();
    (getNetworkDetails as jest.Mock).mockResolvedValue({ network: 'mainnet' });
    setWallet('GABC', 'mainnet');

    renderHook(() => useNetworkGuard());

    // Advance 2 s — one polling tick
    act(() => { jest.advanceTimersByTime(2000); });

    expect(getNetworkDetails).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('stops accelerated polling when mismatch is resolved', () => {
    jest.useFakeTimers();
    (getNetworkDetails as jest.Mock).mockResolvedValue({ network: 'testnet' });
    setWallet('GABC', 'mainnet');

    const { result } = renderHook(() => useNetworkGuard());

    // Simulate user fixing the network
    act(() => { useWalletStore.setState({ network: 'testnet' }); });
    expect(result.current.isMismatch).toBe(false);

    const callsBefore = (getNetworkDetails as jest.Mock).mock.calls.length;

    // Advance further — no new calls should happen
    act(() => { jest.advanceTimersByTime(4000); });
    expect((getNetworkDetails as jest.Mock).mock.calls.length).toBe(callsBefore);
    jest.useRealTimers();
  });
});
