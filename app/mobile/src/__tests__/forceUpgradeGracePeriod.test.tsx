import React from 'react';
import { Text, View, Linking, Platform } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UpdateProvider, useUpdate } from '../contexts/UpdateContext';
import { ForceUpgradeBanner } from '../components/ForceUpgradeBanner';
import { ForceUpgradeScreen } from '../screens/ForceUpgradeScreen';
import {
  FORCE_UPGRADE_DEADLINE_KEY,
  VERSION_CACHE_KEY,
  formatGraceCountdown,
  determineUpgradeState,
} from '../services/updateService';
import type { VersionInfo } from '../types/update';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0' } },
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() =>
      Promise.resolve({ isConnected: true, isInternetReachable: true }),
    ),
  },
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#FFFFFF',
      surface: '#F8FAFC',
      border: '#E2E8F0',
      textPrimary: '#0F172A',
      textSecondary: '#475569',
      textMuted: '#94A3B8',
      error: '#DC2626',
      errorBg: '#FEE2E2',
      errorBorder: '#FECACA',
      warning: '#D97706',
      warningBg: '#FEF3C7',
      warningBorder: '#FDE68A',
      brand: {
        primary: '#2563EB',
      },
    },
  }),
}));

jest.mock('../i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const map: Record<string, string> = {
        'forceUpgrade.updateNow': 'Update Now',
        'forceUpgrade.warningTitle': 'Update Required Soon',
        'forceUpgrade.warningMessage':
          'A mandatory update will be required soon. Please complete and sync your current tasks, then update to continue using Soter.',
        'forceUpgrade.gracePeriodCountdown': `Grace period remaining: ${params?.time ?? ''}`,
        'forceUpgrade.gracePeriodExpired':
          'Grace period has expired. Update required to continue.',
        'forceUpgrade.dismiss': 'Dismiss',
      };
      return map[key] ?? key;
    },
  }),
}));

const mockFetch = jest.fn();
(global as unknown as { fetch: jest.Mock }).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const waitForState = (assertion: () => unknown) =>
  waitFor(assertion, { timeout: 4000 });

const createVersionInfo = (
  minRequiredVersion: string,
  latestVersion = minRequiredVersion,
  extra: Partial<VersionInfo> = {},
): VersionInfo => ({
  latestVersion,
  minRequiredVersion,
  releaseNotes: ['Critical security upgrade'],
  storeUrl: {
    ios: 'https://apps.apple.com/app/soter',
    android: 'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
  },
  ...extra,
});

/** Probe component that inspects update context and renders banner & screen appropriately */
const Probe = () => {
  const { isLoading, isForceUpgrade, upgradeState, remainingGraceMs, versionInfo } =
    useUpdate();

  if (isLoading) {
    return <Text>loading</Text>;
  }

  return (
    <View>
      <Text>{`state:${upgradeState}`}</Text>
      <Text>{`force:${isForceUpgrade}`}</Text>
      <Text>{`remaining:${remainingGraceMs}`}</Text>
      <Text>{`min:${versionInfo?.minRequiredVersion ?? 'none'}`}</Text>
      <ForceUpgradeBanner />
      {isForceUpgrade ? (
        <ForceUpgradeScreen />
      ) : (
        <Text>main-app-screen</Text>
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Force Upgrade Grace Period and Countdown (#1359)', () => {
  beforeEach(async () => {
    await (
      AsyncStorage as typeof AsyncStorage & { clear: () => Promise<void> }
    ).clear();
    mockFetch.mockReset();
    jest.clearAllMocks();
  });

  describe('formatGraceCountdown helper', () => {
    it('formats remaining milliseconds correctly for various durations', () => {
      // <= 0
      expect(formatGraceCountdown(0)).toBe('00:00');
      expect(formatGraceCountdown(-5000)).toBe('00:00');

      // Under 1 hour
      expect(formatGraceCountdown(30 * 1000)).toBe('00:30');
      expect(formatGraceCountdown(65 * 1000)).toBe('01:05');
      expect(formatGraceCountdown(59 * 60 * 1000 + 59 * 1000)).toBe('59:59');

      // 1 hour or more
      expect(formatGraceCountdown(3600 * 1000)).toBe('01:00:00');
      expect(
        formatGraceCountdown(2 * 3600 * 1000 + 15 * 60 * 1000 + 42 * 1000),
      ).toBe('02:15:42');
    });
  });

  describe('determineUpgradeState pure function', () => {
    it('returns "none" when current version satisfies minRequiredVersion', () => {
      const res = determineUpgradeState('1.0.0', '1.0.0', null);
      expect(res.upgradeState).toBe('none');
      expect(res.isForceUpgrade).toBe(false);
      expect(res.remainingGraceMs).toBe(0);
    });

    it('returns "block" immediately when upgrade is required and no deadline is set', () => {
      const res = determineUpgradeState('1.0.0', '2.0.0', null);
      expect(res.upgradeState).toBe('block');
      expect(res.isForceUpgrade).toBe(true);
      expect(res.remainingGraceMs).toBe(0);
    });

    it('returns "warn" when upgrade is required and deadline is in the future', () => {
      const now = 1000000;
      const deadline = now + 60000;
      const res = determineUpgradeState('1.0.0', '2.0.0', deadline, now);
      expect(res.upgradeState).toBe('warn');
      expect(res.isForceUpgrade).toBe(false);
      expect(res.remainingGraceMs).toBe(60000);
      expect(res.graceDeadline).toBe(deadline);
    });

    it('returns "block" when upgrade is required and deadline has passed', () => {
      const now = 1000000;
      const deadline = now - 5000;
      const res = determineUpgradeState('1.0.0', '2.0.0', deadline, now);
      expect(res.upgradeState).toBe('block');
      expect(res.isForceUpgrade).toBe(true);
      expect(res.remainingGraceMs).toBe(0);
    });
  });

  describe('Acceptance Criteria 1 & 2: Warn state and immediate-block case', () => {
    it('immediate-block case: hard blocks usage immediately when no grace period is configured', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createVersionInfo('2.0.0', '2.0.0'),
      });

      const { getByText, queryByText } = render(
        <UpdateProvider>
          <Probe />
        </UpdateProvider>,
      );

      await waitForState(() => expect(getByText('state:block')).toBeTruthy());
      expect(getByText('force:true')).toBeTruthy();

      // Usage is blocked immediately
      expect(queryByText('main-app-screen')).toBeNull();
      expect(getByText('Update Required')).toBeTruthy();
      expect(getByText('Current Version Incompatible')).toBeTruthy();
      expect(getByText('Required: 2.0.0')).toBeTruthy();
    });

    it('warn state: allows continued use and renders visible countdown warning banner before hard block', async () => {
      const gracePeriodMs = 10 * 60 * 1000; // 10 minutes
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () =>
          createVersionInfo('2.0.0', '2.0.0', { gracePeriodMs }),
      });

      const { getByText } = render(
        <UpdateProvider>
          <Probe />
        </UpdateProvider>,
      );

      await waitForState(() => expect(getByText('state:warn')).toBeTruthy());
      expect(getByText('force:false')).toBeTruthy();

      // Field worker can continue using the application!
      expect(getByText('main-app-screen')).toBeTruthy();

      // Visible warning banner with countdown is rendered
      expect(getByText('Update Required Soon')).toBeTruthy();
      expect(getByText('Update Now')).toBeTruthy();
      expect(getByText('Dismiss')).toBeTruthy();

      // Verify deadline was persisted in AsyncStorage for resilience across restarts
      const stored = await AsyncStorage.getItem(FORCE_UPGRADE_DEADLINE_KEY);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.minRequiredVersion).toBe('2.0.0');
      expect(parsed.deadline).toBeGreaterThan(Date.now());
    });

    it('warn state respects configurable defaultGracePeriodMs on UpdateProvider', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createVersionInfo('2.0.0', '2.0.0'),
      });

      const { getByText } = render(
        <UpdateProvider defaultGracePeriodMs={300000}>
          <Probe />
        </UpdateProvider>,
      );

      await waitForState(() => expect(getByText('state:warn')).toBeTruthy());
      expect(getByText('force:false')).toBeTruthy();
      expect(getByText('main-app-screen')).toBeTruthy();
      expect(getByText('Update Required Soon')).toBeTruthy();
    });
  });

  describe('Acceptance Criteria 3: Countdown reaching zero transitions from warn to block', () => {
    it('transitions from "warn" to "block" when countdown reaches zero, displaying hard block screen', async () => {
      const gracePeriodMs = 1000; // 1 second grace
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () =>
          createVersionInfo('2.0.0', '2.0.0', { gracePeriodMs }),
      });

      const { getByText, queryByText } = render(
        <UpdateProvider>
          <Probe />
        </UpdateProvider>,
      );

      // Initially in warn state
      await waitForState(() => expect(getByText('state:warn')).toBeTruthy());
      expect(getByText('force:false')).toBeTruthy();
      expect(getByText('main-app-screen')).toBeTruthy();

      // When the countdown reaches zero (after ~1.1s), transitions to hard block
      await waitFor(() => expect(getByText('state:block')).toBeTruthy(), {
        timeout: 4000,
      });

      expect(getByText('force:true')).toBeTruthy();
      expect(queryByText('main-app-screen')).toBeNull();
      expect(getByText('Update Required')).toBeTruthy();
      expect(
        getByText('Grace period has expired. Update required to continue.'),
      ).toBeTruthy();
    });
  });

  describe('Banner interactions', () => {
    it('redirects to store URL when Update Now button is pressed', async () => {
      const openURLSpy = jest
        .spyOn(Linking, 'openURL')
        .mockImplementation(() => Promise.resolve(true));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () =>
          createVersionInfo('2.0.0', '2.0.0', { gracePeriodMs: 60000 }),
      });

      const { getByText } = render(
        <UpdateProvider>
          <Probe />
        </UpdateProvider>,
      );

      await waitForState(() => expect(getByText('state:warn')).toBeTruthy());

      const updateButton = getByText('Update Now');
      fireEvent.press(updateButton);

      const expectedUrl =
        Platform.OS === 'ios'
          ? 'https://apps.apple.com/app/soter'
          : 'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile';

      expect(openURLSpy).toHaveBeenCalledWith(expectedUrl);
      openURLSpy.mockRestore();
    });

    it('dismisses warning banner when Dismiss button is pressed', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () =>
          createVersionInfo('2.0.0', '2.0.0', { gracePeriodMs: 60000 }),
      });

      const { getByText, queryByText } = render(
        <UpdateProvider>
          <Probe />
        </UpdateProvider>,
      );

      await waitForState(() => expect(getByText('state:warn')).toBeTruthy());
      expect(getByText('Update Required Soon')).toBeTruthy();

      fireEvent.press(getByText('Dismiss'));

      // Banner is dismissed, but main app screen stays active
      expect(queryByText('Update Required Soon')).toBeNull();
      expect(getByText('main-app-screen')).toBeTruthy();
    });
  });

  describe('Offline & Cache integration with grace period', () => {
    it('preserves cached grace deadline when offline', async () => {
      const futureDeadline = Date.now() + 600000;
      await AsyncStorage.setItem(
        FORCE_UPGRADE_DEADLINE_KEY,
        JSON.stringify({
          minRequiredVersion: '2.0.0',
          deadline: futureDeadline,
        }),
      );
      await AsyncStorage.setItem(
        VERSION_CACHE_KEY,
        JSON.stringify(createVersionInfo('2.0.0', '2.0.0')),
      );

      // Network fails
      mockFetch.mockRejectedValue(new Error('Network offline'));

      const { getByText } = render(
        <UpdateProvider>
          <Probe />
        </UpdateProvider>,
      );

      await waitForState(() => expect(getByText('state:warn')).toBeTruthy());
      expect(getByText('force:false')).toBeTruthy();
      expect(getByText('main-app-screen')).toBeTruthy();
    });
  });
});
