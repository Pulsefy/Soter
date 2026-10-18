import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UpdateProvider, useUpdate } from '../contexts/UpdateContext';
import { ReleaseNotesModal } from '../components/ReleaseNotesModal';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      surface: '#fff',
      textPrimary: '#111',
      textSecondary: '#555',
      brand: { primary: '#00f' },
    },
  }),
}));

jest.mock('expo-constants', () => ({
  expoConfig: { version: '1.5.0' },
}));

const UpdateStatus = () => {
  const { hasSeenReleaseNotes, markReleaseNotesSeen } = useUpdate();
  return <Text onPress={markReleaseNotesSeen}>{hasSeenReleaseNotes ? 'seen' : 'unseen'}</Text>;
};

const ReleaseNotesApp = () => (
  <>
    <ReleaseNotesModal />
    <UpdateStatus />
  </>
);

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

  it('shows the configured notes version and changes in the app modal', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        latestVersion: '1.6.0',
        minRequiredVersion: '1.4.0',
        releaseNotes: {
          version: '1.5.0',
          title: "What's New",
          changes: ['Faster voucher loading'],
        },
      }),
    }) as jest.Mock;

    const screen = render(
      <UpdateProvider>
        <ReleaseNotesApp />
      </UpdateProvider>,
    );

    await waitFor(() => expect(screen.getByText('unseen')).toBeTruthy());
    expect(screen.getByText("What's New in 1.5.0")).toBeTruthy();
    expect(screen.getByText('Faster voucher loading')).toBeTruthy();
    expect(screen.queryByText("What's New in 1.6.0")).toBeNull();
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
    expect(screen.queryByText(/What's New in/)).toBeNull();
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
    expect(screen.queryByText(/What's New in/)).toBeNull();
  });
});