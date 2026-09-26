/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { NetworkMismatchBanner } from '../NetworkMismatchBanner';
import * as networkGuard from '@/hooks/useNetworkGuard';

jest.mock('@/hooks/useNetworkGuard');
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    if (key === 'wallet.networkMismatch') {
      return `Network mismatch — your wallet is on ${params?.walletNetwork} but this app requires ${params?.expectedNetwork}. Open Freighter and switch to the correct network to continue.`;
    }
    return key;
  },
}));

describe('NetworkMismatchBanner', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when there is no mismatch', () => {
    jest.spyOn(networkGuard, 'useNetworkGuard').mockReturnValue({
      isCorrectNetwork: true,
      isMismatch: false,
      walletNetwork: 'testnet',
      expectedNetwork: 'testnet',
    });

    const { container } = render(<NetworkMismatchBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the banner with wallet and expected network when mismatched', () => {
    jest.spyOn(networkGuard, 'useNetworkGuard').mockReturnValue({
      isCorrectNetwork: false,
      isMismatch: true,
      walletNetwork: 'mainnet',
      expectedNetwork: 'testnet',
    });

    render(<NetworkMismatchBanner />);

    expect(screen.getByText(/MAINNET/)).toBeInTheDocument();
    expect(screen.getByText(/TESTNET/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('has aria-live assertive for screen readers', () => {
    jest.spyOn(networkGuard, 'useNetworkGuard').mockReturnValue({
      isCorrectNetwork: false,
      isMismatch: true,
      walletNetwork: 'futurenet',
      expectedNetwork: 'testnet',
    });

    render(<NetworkMismatchBanner />);
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('renders nothing when wallet is not connected', () => {
    jest.spyOn(networkGuard, 'useNetworkGuard').mockReturnValue({
      isCorrectNetwork: false,
      isMismatch: false,
      walletNetwork: null,
      expectedNetwork: 'testnet',
    });

    const { container } = render(<NetworkMismatchBanner />);
    expect(container.firstChild).toBeNull();
  });
});
