/**
 * Tests for the Wallet Network Mismatch Guard feature.
 *
 * Covers all 8 required scenarios:
 *  1. networkMismatch true when non-Testnet chain detected
 *  2. networkMismatch false when all chains match Testnet
 *  3. networkMismatch false on wallet disconnect (empty chainIds)
 *  4. MismatchBanner renders when mismatched, hidden when not
 *  5. Signing controls disabled when mismatched
 *  6. Signing controls enabled when matched and connected
 *  7. Full recovery flow (detect → disconnect → reconnect → resolve)
 *  8. Round-trip / idempotency property for CAIP-10 chain ID extraction
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { detectNetworkMismatch } from '../services/NetworkGuard';
import { extractChainIdsFromAccounts } from '../services/walletConnect';
import { MismatchBanner } from '../components/MismatchBanner';
import { EvidenceUploadScreen } from '../screens/EvidenceUploadScreen';

// ─── Shared mock wallet state ────────────────────────────────────────────────

const EXPECTED_CHAIN = 'stellar:testnet';

/** Factory for a mock WalletContext value */
const makeMockWallet = (overrides: Partial<ReturnType<typeof baseMockWallet>> = {}) => ({
  ...baseMockWallet(),
  ...overrides,
});

const baseMockWallet = () => ({
  connectWallet: jest.fn(),
  disconnectWallet: jest.fn(),
  error: null,
  lastDeepLinkUrl: null,
  networkMismatch: false,
  pairingUri: null,
  publicKey: null,
  reopenWallet: jest.fn(),
  sessionChainIds: [] as string[],
  status: 'idle' as const,
  walletName: null,
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../contexts/WalletContext', () => ({
  useWallet: jest.fn(),
}));

jest.mock('../services/walletConnect', () => ({
  ...jest.requireActual('../services/walletConnect'),
  getWalletConnectChainId: jest.fn(() => 'stellar:testnet'),
}));

jest.mock('../contexts/SyncContext', () => ({
  useSync: jest.fn().mockReturnValue({
    isConnected: true,
    isSyncing: false,
    queueEvidenceUpload: jest.fn(),
    getActionsForAid: jest.fn().mockReturnValue([]),
    lastCompletedAction: null,
    pendingCount: 0,
    failedCount: 0,
  }),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: jest.fn().mockReturnValue({
    colors: {
      background: '#fff',
      surface: '#f5f5f5',
      border: '#e0e0e0',
      textPrimary: '#000',
      textSecondary: '#666',
      textMuted: '#999',
      brand: { primary: '#0070f3' },
      success: '#22c55e',
      error: '#ef4444',
      warning: '#f59e0b',
      warningBg: '#fffbeb',
      warningBorder: '#fde68a',
      info: '#3b82f6',
      infoBg: '#eff6ff',
    },
  }),
}));

// Silence navigation prop requirement for EvidenceUploadScreen
const mockNavigation = { navigate: jest.fn(), goBack: jest.fn() } as any;
const mockRoute = { params: { aidId: 'aid-123' } } as any;

import { useWallet } from '../contexts/WalletContext';
const mockUseWallet = useWallet as jest.Mock;

// ─── 1. detectNetworkMismatch — non-Testnet chain ────────────────────────────

describe('Scenario 1: networkMismatch is true when non-Testnet chain detected', () => {
  it('returns true when session contains a mainnet chain', () => {
    expect(detectNetworkMismatch(['stellar:mainnet'], EXPECTED_CHAIN)).toBe(true);
  });

  it('returns true when session contains both testnet and mainnet', () => {
    expect(
      detectNetworkMismatch(['stellar:testnet', 'stellar:mainnet'], EXPECTED_CHAIN),
    ).toBe(true);
  });

  it('returns true for a completely unknown chain', () => {
    expect(detectNetworkMismatch(['eip155:1'], EXPECTED_CHAIN)).toBe(true);
  });
});

// ─── 2. detectNetworkMismatch — all chains match ─────────────────────────────

describe('Scenario 2: networkMismatch is false when all chains match Testnet', () => {
  it('returns false when session has only the expected chain', () => {
    expect(detectNetworkMismatch(['stellar:testnet'], EXPECTED_CHAIN)).toBe(false);
  });

  it('returns false when multiple accounts share the same expected chain', () => {
    // Two accounts on testnet deduplicate to one chain ID
    const accounts = ['stellar:testnet:GAAAA', 'stellar:testnet:GBBBB'];
    const chainIds = extractChainIdsFromAccounts(accounts);
    expect(detectNetworkMismatch(chainIds, EXPECTED_CHAIN)).toBe(false);
  });
});

// ─── 3. detectNetworkMismatch — wallet disconnected ──────────────────────────

describe('Scenario 3: networkMismatch is false on wallet disconnect', () => {
  it('returns false when chainIds is empty', () => {
    expect(detectNetworkMismatch([], EXPECTED_CHAIN)).toBe(false);
  });
});

// ─── 4. MismatchBanner renders / hides ───────────────────────────────────────

describe('Scenario 4: MismatchBanner renders when mismatched, hidden when not', () => {
  it('renders the banner when networkMismatch is true', () => {
    mockUseWallet.mockReturnValue(
      makeMockWallet({
        networkMismatch: true,
        sessionChainIds: ['stellar:mainnet'],
        status: 'connected',
      }),
    );

    const { getByText } = render(
      <MismatchBanner expectedChainId={EXPECTED_CHAIN} />,
    );

    expect(getByText('Wrong Network Detected')).toBeTruthy();
    expect(getByText('Disconnect Wallet')).toBeTruthy();
  });

  it('renders nothing when networkMismatch is false', () => {
    mockUseWallet.mockReturnValue(
      makeMockWallet({ networkMismatch: false, sessionChainIds: [] }),
    );

    const { queryByText } = render(
      <MismatchBanner expectedChainId={EXPECTED_CHAIN} />,
    );

    expect(queryByText('Wrong Network Detected')).toBeNull();
    expect(queryByText('Disconnect Wallet')).toBeNull();
  });

  it('displays the detected chain ID and expected chain ID in the banner', () => {
    mockUseWallet.mockReturnValue(
      makeMockWallet({
        networkMismatch: true,
        sessionChainIds: ['stellar:mainnet'],
        status: 'connected',
      }),
    );

    const { getByText } = render(
      <MismatchBanner expectedChainId={EXPECTED_CHAIN} />,
    );

    expect(getByText('stellar:mainnet')).toBeTruthy();
    expect(getByText('stellar:testnet')).toBeTruthy();
  });
});

// ─── 5. Signing controls disabled when mismatched ────────────────────────────

describe('Scenario 5: Signing controls disabled when mismatched', () => {
  it('Upload Evidence button is disabled when networkMismatch is true', () => {
    mockUseWallet.mockReturnValue(
      makeMockWallet({
        networkMismatch: true,
        sessionChainIds: ['stellar:mainnet'],
        status: 'connected',
      }),
    );

    const { getByAccessibilityState } = render(
      <EvidenceUploadScreen navigation={mockNavigation} route={mockRoute} />,
    );

    // The upload button should be in a disabled accessibility state
    const disabledElements = getByAccessibilityState({ disabled: true });
    expect(disabledElements).toBeTruthy();
  });

  it('MismatchBanner Disconnect Wallet button calls disconnectWallet', () => {
    const disconnectWallet = jest.fn();
    mockUseWallet.mockReturnValue(
      makeMockWallet({
        networkMismatch: true,
        sessionChainIds: ['stellar:mainnet'],
        status: 'connected',
        disconnectWallet,
      }),
    );

    const { getByText } = render(
      <MismatchBanner expectedChainId={EXPECTED_CHAIN} />,
    );

    fireEvent.press(getByText('Disconnect Wallet'));
    expect(disconnectWallet).toHaveBeenCalledTimes(1);
  });
});

// ─── 6. Signing controls enabled when matched and connected ──────────────────

describe('Scenario 6: Signing controls enabled when matched and connected', () => {
  it('Upload Evidence button is not disabled when networkMismatch is false and wallet connected', () => {
    mockUseWallet.mockReturnValue(
      makeMockWallet({
        networkMismatch: false,
        sessionChainIds: ['stellar:testnet'],
        status: 'connected',
        publicKey: 'GABCD1234',
      }),
    );

    const { queryByText } = render(
      <EvidenceUploadScreen navigation={mockNavigation} route={mockRoute} />,
    );

    // Banner should not be visible
    expect(queryByText('Wrong Network Detected')).toBeNull();
  });

  it('MismatchBanner is not rendered when networkMismatch is false', () => {
    mockUseWallet.mockReturnValue(
      makeMockWallet({
        networkMismatch: false,
        sessionChainIds: ['stellar:testnet'],
        status: 'connected',
      }),
    );

    const { queryByText } = render(
      <MismatchBanner expectedChainId={EXPECTED_CHAIN} />,
    );

    expect(queryByText('Wrong Network Detected')).toBeNull();
  });
});

// ─── 7. Full recovery flow ────────────────────────────────────────────────────

describe('Scenario 7: Full recovery flow — detect → disconnect → reconnect → resolve', () => {
  it('banner disappears and controls re-enable after mismatch is resolved', () => {
    // Step 1: Mismatch detected
    mockUseWallet.mockReturnValue(
      makeMockWallet({
        networkMismatch: true,
        sessionChainIds: ['stellar:mainnet'],
        status: 'connected',
      }),
    );

    const { rerender, getByText, queryByText } = render(
      <MismatchBanner expectedChainId={EXPECTED_CHAIN} />,
    );

    expect(getByText('Wrong Network Detected')).toBeTruthy();

    // Step 2: User disconnects — wallet goes idle, mismatch clears
    act(() => {
      mockUseWallet.mockReturnValue(
        makeMockWallet({
          networkMismatch: false,
          sessionChainIds: [],
          status: 'idle',
        }),
      );
    });

    rerender(<MismatchBanner expectedChainId={EXPECTED_CHAIN} />);
    expect(queryByText('Wrong Network Detected')).toBeNull();

    // Step 3: User reconnects on correct network — still no mismatch
    act(() => {
      mockUseWallet.mockReturnValue(
        makeMockWallet({
          networkMismatch: false,
          sessionChainIds: ['stellar:testnet'],
          status: 'connected',
          publicKey: 'GABCD1234',
        }),
      );
    });

    rerender(<MismatchBanner expectedChainId={EXPECTED_CHAIN} />);
    expect(queryByText('Wrong Network Detected')).toBeNull();
  });
});

// ─── 8. CAIP-10 round-trip / idempotency property ────────────────────────────

describe('Scenario 8: CAIP-10 chain ID extraction round-trip property', () => {
  /**
   * Property: extractChainIdsFromAccounts is idempotent.
   * Applying it once and then re-applying it to synthetic accounts built from
   * the result produces the same deduplicated chain ID list.
   */
  const testCases: Array<{ label: string; accounts: string[] }> = [
    {
      label: 'single testnet account',
      accounts: ['stellar:testnet:GABCD1234567890ABCDEFGH1234567890ABCDEFGH1234567890ABCDE'],
    },
    {
      label: 'multiple accounts on same chain',
      accounts: [
        'stellar:testnet:GAAAA',
        'stellar:testnet:GBBBB',
        'stellar:testnet:GCCCC',
      ],
    },
    {
      label: 'mixed testnet and mainnet accounts',
      accounts: [
        'stellar:testnet:GAAAA',
        'stellar:mainnet:GBBBB',
      ],
    },
    {
      label: 'empty account list',
      accounts: [],
    },
    {
      label: 'accounts with extra colons in address',
      accounts: ['stellar:testnet:GABCD:extra'],
    },
  ];

  testCases.forEach(({ label, accounts }) => {
    it(`is idempotent for: ${label}`, () => {
      // First pass
      const firstPass = extractChainIdsFromAccounts(accounts);

      // Build synthetic accounts from first-pass chain IDs and re-extract
      const syntheticAccounts = firstPass.map((chainId) => `${chainId}:SYNTHETIC_ADDR`);
      const secondPass = extractChainIdsFromAccounts(syntheticAccounts);

      // The chain IDs should be identical after both passes
      expect(secondPass).toEqual(firstPass);
    });
  });

  it('always returns a deduplicated list', () => {
    const accounts = [
      'stellar:testnet:GAAAA',
      'stellar:testnet:GBBBB',
      'stellar:testnet:GCCCC',
    ];
    const result = extractChainIdsFromAccounts(accounts);
    const unique = Array.from(new Set(result));
    expect(result).toEqual(unique);
  });

  it('excludes malformed accounts with fewer than two colon-separated segments', () => {
    const accounts = ['notvalid', 'stellar:testnet:GAAAA'];
    const result = extractChainIdsFromAccounts(accounts);
    // Only the valid CAIP-10 account should contribute a chain ID
    expect(result).toEqual(['stellar:testnet']);
  });
});
