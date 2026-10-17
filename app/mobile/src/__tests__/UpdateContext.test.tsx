import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UpdateProvider, useUpdate } from '../contexts/UpdateContext';

jest.mock('expo-constants', () => ({
  expoConfig: { version: '1.5.0' },
}));

const UpdateStatus = () => {
  const { hasSeenReleaseNotes, markReleaseNotesSeen } = useUpdate();
  return <Text onPress={markReleaseNotesSeen}>{hasSeenReleaseNotes ? 'seen' : 'unseen'}</Text>;
};

describe('UpdateProvider release notes', () => {
  const originalFetch = global.fetch;

  beforeEach(async () => {
    await AsyncStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        releaseNotes: { version: '1.5.0', changes: ['Faster voucher loading'] },
      }),
    }) as jest.Mock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('shows notes for the installed version once and remembers acknowledgement', async () => {
    const firstLaunch = render(
      <UpdateProvider>
        <UpdateStatus />
      </UpdateProvider>,
    );

    await waitFor(() => expect(firstLaunch.getByText('unseen')).toBeTruthy());
    fireEvent.press(firstLaunch.getByText('unseen'));
    await waitFor(() => expect(firstLaunch.getByText('seen')).toBeTruthy());
    firstLaunch.unmount();

    const nextLaunch = render(
      <UpdateProvider>
        <UpdateStatus />
      </UpdateProvider>,
    );
    await waitFor(() => expect(nextLaunch.getByText('seen')).toBeTruthy());
  });

  it('does not offer notes when none are configured for the installed version', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        releaseNotes: { version: '1.5.0', changes: [] },
      }),
    }) as jest.Mock;

    const screen = render(
      <UpdateProvider>
        <UpdateStatus />
      </UpdateProvider>,
    );
    await waitFor(() => expect(screen.getByText('seen')).toBeTruthy());
  });

  it('does not offer notes targeted at another version', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        releaseNotes: { version: '1.4.0', changes: ['Previous release notes'] },
      }),
    }) as jest.Mock;

    const screen = render(
      <UpdateProvider>
        <UpdateStatus />
      </UpdateProvider>,
    );
    await waitFor(() => expect(screen.getByText('seen')).toBeTruthy());
  });
});