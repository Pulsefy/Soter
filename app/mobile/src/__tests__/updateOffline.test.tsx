import React from 'react';
import { Text, View } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UpdateProvider, useUpdate } from '../contexts/UpdateContext';
import {
  VERSION_CACHE_KEY,
  loadCachedVersionInfo,
} from '../services/updateService';
import type { VersionInfo } from '../types/update';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0' } },
}));

let mockNetInfoListener:
  | ((state: { isConnected: boolean; isInternetReachable: boolean | null }) => void)
  | null = null;

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(
      (
        listener: (state: {
          isConnected: boolean;
          isInternetReachable: boolean | null;
        }) => void,
      ) => {
        mockNetInfoListener = listener;
        return jest.fn();
      },
    ),
    fetch: jest.fn(() =>
      Promise.resolve({ isConnected: true, isInternetReachable: true }),
    ),
  },
}));

const mockFetch = jest.fn();
(global as unknown as { fetch: jest.Mock }).fetch = mockFetch;

const waitForState = (assertion: () => unknown) =>
  waitFor(assertion, { timeout: 10000 });

const versionInfo = (
  minRequiredVersion: string,
  latestVersion = minRequiredVersion,
): VersionInfo => ({
  latestVersion,
  minRequiredVersion,
  releaseNotes: [],
  storeUrl: {
    ios: 'https://apps.apple.com/app/soter',
    android: 'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
  },
});

const Probe = () => {
  const { isLoading, isForceUpgrade, versionInfo: info } = useUpdate();
  if (isLoading) return <Text>loading</Text>;
  return (
    <View>
      <Text>{`force:${isForceUpgrade}`}</Text>
      <Text>{`min:${info?.minRequiredVersion ?? 'none'}`}</Text>
    </View>
  );
};

const renderProvider = () =>
  render(
    <UpdateProvider>
      <Probe />
    </UpdateProvider>,
  );

describe('force upgrade offline support', () => {
  beforeEach(async () => {
    await (
      AsyncStorage as typeof AsyncStorage & { clear: () => Promise<void> }
    ).clear();
    mockFetch.mockReset();
    mockNetInfoListener = null;
  });

  it('does not block app usage when offline and the last check passed', async () => {
    await AsyncStorage.setItem(
      VERSION_CACHE_KEY,
      JSON.stringify(versionInfo('0.9.0', '1.0.0')),
    );
    mockFetch.mockRejectedValue(new Error('network unreachable'));

    const { getByText } = renderProvider();

    await waitForState(() => expect(getByText('force:false')).toBeTruthy());
    expect(getByText('min:0.9.0')).toBeTruthy();
  });

  it('fails open when offline with no cached version policy', async () => {
    mockFetch.mockRejectedValue(new Error('network unreachable'));

    const { getByText } = renderProvider();

    await waitForState(() => expect(getByText('force:false')).toBeTruthy());
    expect(getByText('min:none')).toBeTruthy();
  });

  it('still forces an upgrade when the cached policy requires it', async () => {
    await AsyncStorage.setItem(
      VERSION_CACHE_KEY,
      JSON.stringify(versionInfo('2.0.0')),
    );
    mockFetch.mockRejectedValue(new Error('network unreachable'));

    const { getByText } = renderProvider();

    await waitForState(() => expect(getByText('force:true')).toBeTruthy());
    expect(getByText('min:2.0.0')).toBeTruthy();
  });

  it('caches a successful check for later offline use', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        latestVersion: '1.2.0',
        minRequiredVersion: '1.0.0',
      }),
    });

    const { getByText } = renderProvider();

    await waitForState(() => expect(getByText('force:false')).toBeTruthy());
    await waitForState(() =>
      expect(loadCachedVersionInfo()).resolves.toMatchObject({
        minRequiredVersion: '1.0.0',
      }),
    );
  });

  it('re-runs the check promptly when connectivity returns', async () => {
    await AsyncStorage.setItem(
      VERSION_CACHE_KEY,
      JSON.stringify(versionInfo('0.9.0', '1.0.0')),
    );
    mockFetch.mockRejectedValue(new Error('network unreachable'));

    const { getByText } = renderProvider();
    await waitForState(() => expect(getByText('force:false')).toBeTruthy());

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        latestVersion: '2.0.0',
        minRequiredVersion: '2.0.0',
      }),
    });

    await act(async () => {
      mockNetInfoListener?.({ isConnected: false, isInternetReachable: false });
    });
    await act(async () => {
      mockNetInfoListener?.({ isConnected: true, isInternetReachable: true });
    });

    await waitForState(() => expect(getByText('force:true')).toBeTruthy());
    expect(getByText('min:2.0.0')).toBeTruthy();
  });
});
