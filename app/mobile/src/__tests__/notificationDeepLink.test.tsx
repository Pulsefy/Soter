import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as notificationService from '../services/notificationService';
import {
  NotificationProvider,
  useNotification,
} from '../contexts/NotificationContext';
import { deepLinkToNavParams } from '../navigation/types';

type NotificationResponse = {
  notification: {
    request: {
      identifier: string;
      content: {
        data: Record<string, unknown>;
      };
    };
  };
};

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('../services/notificationService', () => {
  const actual = jest.requireActual('../services/notificationService');
  return {
    __esModule: true,
    ...actual,
    requestNotificationPermission: jest.fn(),
    getExpoPushToken: jest.fn(),
    configureAndroidChannel: jest.fn(),
  };
});

const MockConsumer = () => {
  const { pendingDeepLink } = useNotification();
  return (
    <Text testID="pending-deep-link">
      {pendingDeepLink
        ? `${pendingDeepLink.screen}:${JSON.stringify(pendingDeepLink.params)}`
        : 'none'}
    </Text>
  );
};

describe('notification deep link routing', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    await AsyncStorage.clear();
    (
      Notifications.addNotificationResponseReceivedListener as jest.Mock
    ).mockImplementation(() => ({ remove: jest.fn() }));
    (
      Notifications.addNotificationReceivedListener as jest.Mock
    ).mockImplementation(() => ({ remove: jest.fn() }));
  });

  it('maps claim receipt and package detail targets to navigation params', () => {
    expect(
      deepLinkToNavParams({
        screen: 'ClaimReceipt',
        params: { claimId: 'claim-999' },
      }),
    ).toEqual({ screen: 'ClaimReceipt', params: { claimId: 'claim-999' } });

    expect(
      deepLinkToNavParams({
        screen: 'AidDetails',
        params: { aidId: 'aid-888' },
      }),
    ).toEqual({ screen: 'AidDetails', params: { aidId: 'aid-888' } });
  });

  it('handles a cold-start notification tap and exposes a pending deep link', async () => {
    const getLastNotificationResponseAsync =
      Notifications.getLastNotificationResponseAsync as jest.Mock;
    const requestNotificationPermission =
      notificationService.requestNotificationPermission as jest.Mock;
    const getExpoPushToken = notificationService.getExpoPushToken as jest.Mock;
    const configureAndroidChannel =
      notificationService.configureAndroidChannel as jest.Mock;

    getLastNotificationResponseAsync.mockResolvedValue({
      notification: {
        request: {
          identifier: 'cold-start-id',
          content: {
            data: {
              target: { screen: 'AidDetails', params: { aidId: 'aid-123' } },
            },
          },
        },
      },
    } as NotificationResponse);
    requestNotificationPermission.mockResolvedValue(true);
    getExpoPushToken.mockResolvedValue('expo-token');
    configureAndroidChannel.mockResolvedValue(undefined);

    const { getByTestId } = render(
      <NotificationProvider>
        <MockConsumer />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('pending-deep-link').props.children).toContain(
        'AidDetails',
      );
      expect(getByTestId('pending-deep-link').props.children).toContain(
        'aid-123',
      );
    });
  });

  it('handles a background notification tap and exposes a pending deep link', async () => {
    const addNotificationResponseReceivedListener =
      Notifications.addNotificationResponseReceivedListener as jest.Mock;
    const requestNotificationPermission =
      notificationService.requestNotificationPermission as jest.Mock;
    const getExpoPushToken = notificationService.getExpoPushToken as jest.Mock;
    const configureAndroidChannel =
      notificationService.configureAndroidChannel as jest.Mock;

    let responseHandler: (response: NotificationResponse) => void = () => {};
    addNotificationResponseReceivedListener.mockImplementation(handler => {
      responseHandler = handler;
      return { remove: jest.fn() };
    });

    (
      Notifications.getLastNotificationResponseAsync as jest.Mock
    ).mockResolvedValue(null);
    requestNotificationPermission.mockResolvedValue(true);
    getExpoPushToken.mockResolvedValue('expo-token');
    configureAndroidChannel.mockResolvedValue(undefined);

    const { getByTestId } = render(
      <NotificationProvider>
        <MockConsumer />
      </NotificationProvider>,
    );

    await act(async () => {
      responseHandler({
        notification: {
          request: {
            identifier: 'bg-tap-id',
            content: {
              data: {
                target: {
                  screen: 'ClaimReceipt',
                  params: { claimId: 'claim-456' },
                },
              },
            },
          },
        },
      } as NotificationResponse);
    });

    await waitFor(() => {
      expect(getByTestId('pending-deep-link').props.children).toContain(
        'ClaimReceipt',
      );
      expect(getByTestId('pending-deep-link').props.children).toContain(
        'claim-456',
      );
    });
  });

  it('filters out duplicate notification responses with the same identifier', async () => {
    const getLastNotificationResponseAsync =
      Notifications.getLastNotificationResponseAsync as jest.Mock;
    const requestNotificationPermission =
      notificationService.requestNotificationPermission as jest.Mock;
    const getExpoPushToken = notificationService.getExpoPushToken as jest.Mock;
    const configureAndroidChannel =
      notificationService.configureAndroidChannel as jest.Mock;

    // First, simulate opening via notification response with ID 'dup-id'
    getLastNotificationResponseAsync.mockResolvedValue({
      notification: {
        request: {
          identifier: 'dup-id',
          content: {
            data: {
              target: { screen: 'Settings' },
            },
          },
        },
      },
    } as NotificationResponse);
    requestNotificationPermission.mockResolvedValue(true);
    getExpoPushToken.mockResolvedValue('expo-token');
    configureAndroidChannel.mockResolvedValue(undefined);

    const { getByTestId } = render(
      <NotificationProvider>
        <MockConsumer />
      </NotificationProvider>,
    );

    // Should expose Settings deep link
    await waitFor(() => {
      expect(getByTestId('pending-deep-link').props.children).toContain('Settings');
    });

    // Now, simulate another cold start mount with the SAME identifier
    // We expect the duplicate to be filtered out (so it should display 'none')
    const { getByTestId: getByTestId2 } = render(
      <NotificationProvider>
        <MockConsumer />
      </NotificationProvider>,
    );

    // Since 'dup-id' was already processed, it should be ignored, exposing 'none'
    await waitFor(() => {
      expect(getByTestId2('pending-deep-link').props.children).toBe('none');
    });
  });
});
