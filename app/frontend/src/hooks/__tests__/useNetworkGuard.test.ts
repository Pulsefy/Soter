/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { useWalletStore } from '@/lib/walletStore';
import { useNetworkGuard } from '../useNetworkGuard';

// Mock env so EXPECTED_NETWORK is deterministic in tests
jest.mock('@/lib/env', () => ({
  EXPECTED_NETWORK: 'testnet',
  stellarNetwork: 'testnet',
}));

function setWallet(publicKey: string | null, network: string | null) {
  act(() => {
    useWalletStore.setState({ publicKey, network });
  });
}

afterEach(() => {
  setWallet(null, null);
});

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
});
