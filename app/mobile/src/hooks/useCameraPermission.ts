/**
 * useCameraPermission - Graceful camera permission handling (#930)
 *
 * This hook provides robust camera permission management for field workers,
 * including:
 * - Clear user communication when access is denied
 * - Deep link to system settings for manual enable
 * - Distinction between first-time denial and permanent denial
 * - Auto re-verification when returning from settings
 * - Fallback alternatives (e.g., photo library selection)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Linking, Platform } from 'react-native';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

export type PermissionState =
  | 'undetermined' // Not yet requested
  | 'requesting'   // Currently requesting
  | 'granted'      // Access granted
  | 'denied'       // First-time denial (can ask again)
  | 'blocked';     // Permanently denied (must go to settings)

export interface CameraPermissionResult {
  /** Current permission state */
  permissionState: PermissionState;
  /** Whether camera is available for use */
  isGranted: boolean;
  /** Whether permission was explicitly denied but can be re-requested */
  isDenied: boolean;
  /** Whether permission is permanently blocked (requires settings) */
  isBlocked: boolean;
  /** Whether we're currently checking permission */
  isChecking: boolean;
  /** Request camera permission */
  requestPermission: () => Promise<boolean>;
  /** Open system settings to enable camera */
  openSettings: () => Promise<void>;
  /** Refresh permission status (called automatically on app foreground) */
  refreshPermission: () => Promise<void>;
  /** User-friendly message explaining the current state */
  statusMessage: string;
  /** Whether photo library can be used as fallback */
  canUsePhotoLibrary: boolean;
  /** Request photo library permission as fallback */
  requestPhotoLibraryPermission: () => Promise<boolean>;
}

/**
 * Get a user-friendly message for the current permission state.
 */
function getStatusMessage(state: PermissionState): string {
  switch (state) {
    case 'undetermined':
      return 'Camera permission is required to scan QR codes or capture evidence.';
    case 'requesting':
      return 'Requesting camera permission...';
    case 'granted':
      return 'Camera is ready to use.';
    case 'denied':
      return 'Camera access was denied. You can grant permission when prompted again.';
    case 'blocked':
      return 'Camera access is blocked. Please enable it in your device settings to continue.';
    default:
      return '';
  }
}

/**
 * Hook for graceful camera permission handling.
 *
 * Features:
 * - Tracks permission state with granular status
 * - Provides settings deep link for blocked permissions
 * - Auto-refreshes permission when app returns to foreground
 * - Supports photo library as fallback alternative
 *
 * @param options.autoRequest - Automatically request permission on mount (default: true)
 */
export function useCameraPermission(
  options: { autoRequest?: boolean } = {}
): CameraPermissionResult {
  const { autoRequest = true } = options;

  const [permissionState, setPermissionState] = useState<PermissionState>('undetermined');
  const [isChecking, setIsChecking] = useState(false);
  const [canUsePhotoLibrary, setCanUsePhotoLibrary] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const hasRequestedRef = useRef(false);

  /**
   * Check current camera permission status without requesting.
   */
  const checkPermission = useCallback(async (): Promise<PermissionState> => {
    try {
      const { status, canAskAgain } = await Camera.getCameraPermissionsAsync();

      if (status === 'granted') {
        return 'granted';
      }

      if (status === 'denied') {
        // On iOS, canAskAgain is false after "Don't Allow"
        // On Android, it's false after "Deny" with "Don't ask again" checked
        return canAskAgain ? 'denied' : 'blocked';
      }

      return 'undetermined';
    } catch (error) {
      console.warn('Error checking camera permission:', error);
      return 'undetermined';
    }
  }, []);

  /**
   * Refresh permission status (called on app foreground).
   */
  const refreshPermission = useCallback(async (): Promise<void> => {
    setIsChecking(true);
    try {
      const state = await checkPermission();
      setPermissionState(state);
    } finally {
      setIsChecking(false);
    }
  }, [checkPermission]);

  /**
   * Request camera permission from the user.
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    setPermissionState('requesting');
    setIsChecking(true);
    hasRequestedRef.current = true;

    try {
      const { status, canAskAgain } = await Camera.requestCameraPermissionsAsync();

      if (status === 'granted') {
        setPermissionState('granted');
        return true;
      }

      if (status === 'denied') {
        setPermissionState(canAskAgain ? 'denied' : 'blocked');
        return false;
      }

      setPermissionState('undetermined');
      return false;
    } catch (error) {
      console.warn('Error requesting camera permission:', error);
      setPermissionState('denied');
      return false;
    } finally {
      setIsChecking(false);
    }
  }, []);

  /**
   * Open system settings to enable camera permission.
   */
  const openSettings = useCallback(async (): Promise<void> => {
    try {
      if (Platform.OS === 'ios') {
        await Linking.openURL('app-settings:');
      } else {
        await Linking.openSettings();
      }
    } catch (error) {
      console.warn('Error opening settings:', error);
      // Fallback for older Android versions
      try {
        await Linking.openURL('app-settings:');
      } catch {
        console.warn('Could not open settings');
      }
    }
  }, []);

  /**
   * Check if photo library can be used as fallback.
   */
  const checkPhotoLibraryPermission = useCallback(async (): Promise<void> => {
    try {
      const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
      setCanUsePhotoLibrary(status === 'granted');
    } catch {
      setCanUsePhotoLibrary(false);
    }
  }, []);

  /**
   * Request photo library permission as fallback.
   */
  const requestPhotoLibraryPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      const granted = status === 'granted';
      setCanUsePhotoLibrary(granted);
      return granted;
    } catch {
      return false;
    }
  }, []);

  // Initial permission check
  useEffect(() => {
    const initialize = async () => {
      const state = await checkPermission();
      setPermissionState(state);

      // Auto-request if undetermined and enabled
      if (autoRequest && state === 'undetermined' && !hasRequestedRef.current) {
        await requestPermission();
      }

      // Check photo library availability
      await checkPhotoLibraryPermission();
    };

    initialize();
  }, [autoRequest, checkPermission, requestPermission, checkPhotoLibraryPermission]);

  // Re-check permission when app returns to foreground
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // Only refresh when coming back to foreground from background
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // User may have changed permission in settings
        refreshPermission();
        checkPhotoLibraryPermission();
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [refreshPermission, checkPhotoLibraryPermission]);

  const isGranted = permissionState === 'granted';
  const isDenied = permissionState === 'denied';
  const isBlocked = permissionState === 'blocked';
  const statusMessage = getStatusMessage(permissionState);

  return {
    permissionState,
    isGranted,
    isDenied,
    isBlocked,
    isChecking,
    requestPermission,
    openSettings,
    refreshPermission,
    statusMessage,
    canUsePhotoLibrary,
    requestPhotoLibraryPermission,
  };
}

export default useCameraPermission;
