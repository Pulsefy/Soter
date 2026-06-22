import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as Notifications from 'expo-notifications';
import {
  DeepLinkTarget,
  requestNotificationPermission,
  getExpoPushToken,
  configureAndroidChannel,
  resolveDeepLink,
} from '../services/notificationService';

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

interface NotificationContextValue {
  /** Whether the user has granted notification permission */
  permissionGranted: boolean;
  /** The current Expo push token (null on simulator / before permission) */
  expoPushToken: string | null;
  /** The most recent deep-link target derived from a notification tap */
  pendingDeepLink: DeepLinkTarget | null;
  /** Clear the pending deep link after navigation has consumed it */
  consumeDeepLink: () => void;
  /** Manually request notification permission (e.g. from Settings) */
  requestPermission: () => Promise<boolean>;
}

const NotificationContext = createContext<NotificationContextValue>({
  permissionGranted: false,
  expoPushToken: null,
  pendingDeepLink: null,
  consumeDeepLink: () => {},
  requestPermission: async () => false,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const NotificationProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [pendingDeepLink, setPendingDeepLink] = useState<DeepLinkTarget | null>(null);

  // Keep refs so listeners always see the latest navigation ref
  const navigationRef = useRef<any>(null);

  // -----------------------------------------------------------------------
  // Initialise permissions, token, and Android channels
  // -----------------------------------------------------------------------
  const initNotifications = useCallback(async () => {
    const granted = await requestNotificationPermission();
    setPermissionGranted(granted);

    if (granted) {
      await configureAndroidChannel();
      const token = await getExpoPushToken();
      setExpoPushToken(token);
      if (token) {
        console.log('[Notifications] Expo push token:', token);
        // TODO: send token to backend for per-user push targeting
      }
    }
  }, []);

  // -----------------------------------------------------------------------
  // Cold-start handling
  // -----------------------------------------------------------------------
  // When the app was completely killed and the user taps a notification,
  // `getLastNotificationResponseAsync` returns the notification that opened
  // the app. We check it once on mount.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const checkInitialNotification = async () => {
      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      if (lastResponse) {
        const data = lastResponse.notification.request.content.data as
          | Record<string, unknown>
          | undefined;
        const target = resolveDeepLink(data);
        if (target) {
          // Small delay so the navigation container is ready
          setTimeout(() => setPendingDeepLink(target), 500);
        }
      }
    };

    void checkInitialNotification();
  }, []);

  // -----------------------------------------------------------------------
  // Foreground & background tap handling
  // -----------------------------------------------------------------------
  useEffect(() => {
    // This listener fires when:
    //  - The app is in the foreground and the user taps the notification
    //  - The app is in the background and the user taps the notification
    //    (bringing it to the foreground)
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | undefined;
        const target = resolveDeepLink(data);
        if (target) {
          setPendingDeepLink(target);
        }
      },
    );

    return () => subscription.remove();
  }, []);

  // -----------------------------------------------------------------------
  // Foreground notification received handler (optional badge / analytics)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log(
          '[Notifications] Received in foreground:',
          notification.request.content.title,
        );
        // Could update badge count or show an in-app banner here
      },
    );

    return () => subscription.remove();
  }, []);

  // Background notification response on Android is already handled by the
  // `addNotificationResponseReceivedListener` above. When the app is
  // launched from a terminated state via notification tap,
  // `getLastNotificationResponseAsync` (checked on mount) handles it.
  // No additional headless task registration is required because the
  // Expo notifications module automatically brings the app to the
  // foreground when a notification is tapped, at which point the
  // response listener fires.

  // -----------------------------------------------------------------------
  // Init on mount
  // -----------------------------------------------------------------------
  useEffect(() => {
    void initNotifications();
  }, [initNotifications]);

  // -----------------------------------------------------------------------
  // Public helpers
  // -----------------------------------------------------------------------
  const consumeDeepLink = useCallback(() => {
    setPendingDeepLink(null);
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const granted = await requestNotificationPermission();
    setPermissionGranted(granted);
    if (granted) {
      const token = await getExpoPushToken();
      setExpoPushToken(token);
    }
    return granted;
  }, []);

  const value = useMemo<NotificationContextValue>(
    () => ({
      permissionGranted,
      expoPushToken,
      pendingDeepLink,
      consumeDeepLink,
      requestPermission,
    }),
    [permissionGranted, expoPushToken, pendingDeepLink, consumeDeepLink, requestPermission],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotification = () => useContext(NotificationContext);
