import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as Device from 'expo-device';

// ---------------------------------------------------------------------------
// Configure how notifications appear when the app is in the foreground
// ---------------------------------------------------------------------------
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ---------------------------------------------------------------------------
// Deep-link route mapping
// ---------------------------------------------------------------------------

/**
 * Supported deep-link targets that a push notification can open.
 *
 * Each key corresponds to a screen name in `RootStackParamList`.
 * The `params` value describes the screen params the route expects.
 */
export interface DeepLinkTarget {
  screen: string;
  params?: Record<string, string>;
}

/**
 * Notification payload keys that carry deep-link information.
 * The backend should include a `target` object in the notification `data`:
 *
 * ```json
 * {
 *   "data": {
 *     "target": { "screen": "AidDetails", "params": { "aidId": "123" } }
 *   }
 * }
 * ```
 *
 * For backwards compatibility we also honour a top-level `screen` + `aidId`
 * pattern.
 */
export function resolveDeepLink(
  data: Record<string, unknown> | undefined,
): DeepLinkTarget | null {
  if (!data) return null;

  // Preferred: structured `target` object
  const target = data.target as DeepLinkTarget | undefined;
  if (target?.screen) {
    return { screen: target.screen, params: target.params };
  }

  // Fallback: top-level legacy keys
  const screen = data.screen as string | undefined;
  if (!screen) return null;

  switch (screen) {
    case 'AidDetails': {
      const aidId = data.aidId as string | undefined;
      return aidId ? { screen: 'AidDetails', params: { aidId } } : null;
    }
    case 'ClaimReceipt': {
      const claimId = data.claimId as string | undefined;
      return claimId ? { screen: 'ClaimReceipt', params: { claimId } } : null;
    }
    case 'Settings':
      return { screen: 'Settings' };
    case 'AidOverview':
      return { screen: 'AidOverview' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    console.warn('[Notifications] Push notifications require a physical device.');
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[Notifications] Permission not granted for push notifications.');
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Push token
// ---------------------------------------------------------------------------

export async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    });
    return data;
  } catch (error) {
    console.error('[Notifications] Failed to get Expo push token:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Android channel setup
// ---------------------------------------------------------------------------

export async function configureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('default', {
    name: 'Soter Notifications',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1E90FF',
    description: 'Important claim and verification updates from Soter',
  });

  // Separate channel for verification status updates
  await Notifications.setNotificationChannelAsync('verification', {
    name: 'Verification Updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#32CD32',
    description: 'Updates when verification status changes',
  });

  // Separate channel for claim lifecycle updates
  await Notifications.setNotificationChannelAsync('claims', {
    name: 'Claim Updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FFA500',
    description: 'Updates when claim status changes',
  });
}

// ---------------------------------------------------------------------------
// Schedule a local notification (useful for testing / foreground alerts)
// ---------------------------------------------------------------------------

export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId?: string,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: true,
    },
    trigger: null, // immediate
  });
}
