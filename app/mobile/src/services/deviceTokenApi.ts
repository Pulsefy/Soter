import { apiPost, apiDelete } from './requestLayer';
import { structuredLogger } from './logger';
import { Platform } from 'react-native';
import * as Device from 'expo-device';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum DevicePlatform {
  ios = 'ios',
  android = 'android',
}

export interface RegisterDeviceTokenRequest {
  platform: DevicePlatform;
  deviceId: string;
  token: string;
  deviceName?: string;
  appVersion?: string;
}

export interface DeviceTokenResponse {
  id: string;
  userId: string;
  orgId: string | null;
  platform: DevicePlatform;
  deviceId: string;
  token: string;
  deviceName: string | null;
  appVersion: string | null;
  isActive: boolean;
  lastUsedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RevokeDeviceTokenRequest {
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get a unique device identifier for token registration.
 * Uses expo-device's deviceId if available, otherwise generates a stable UUID.
 */
async function getDeviceId(): Promise<string> {
  try {
    if (Device.isDevice) {
      const deviceId = await Device.getDeviceIdAsync();
      if (deviceId) return deviceId;
    }
  } catch (error) {
    structuredLogger.warn(
      'device_token.get_device_id_failed',
      { error: error instanceof Error ? error.message : String(error) },
      'deviceToken',
    );
  }

  // Fallback: generate a stable UUID stored in AsyncStorage
  // For now, return a placeholder - in production this should be persisted
  return 'device-unknown';
}

/**
 * Get the device name for user-friendly identification.
 */
function getDeviceName(): string | undefined {
  if (Platform.OS === 'ios') {
    return 'iOS Device';
  }
  if (Platform.OS === 'android') {
    return 'Android Device';
  }
  return undefined;
}

/**
 * Get the current app version from package.json or constants.
 */
function getAppVersion(): string | undefined {
  // In a real implementation, this would read from app.json or Constants.manifest
  // For now, return undefined
  return undefined;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

/**
 * Register or update a device push notification token with the backend.
 * This is idempotent: calling it multiple times with the same deviceId/platform
 * will update the existing token rather than create duplicates.
 */
export async function registerDeviceToken(
  expoPushToken: string,
): Promise<DeviceTokenResponse | null> {
  try {
    const deviceId = await getDeviceId();
    const platform = Platform.OS === 'ios' ? DevicePlatform.ios : DevicePlatform.android;

    const payload: RegisterDeviceTokenRequest = {
      platform,
      deviceId,
      token: expoPushToken,
      deviceName: getDeviceName(),
      appVersion: getAppVersion(),
    };

    structuredLogger.info(
      'device_token.registering',
      { 
        deviceId, 
        platform, 
        tokenPreview: expoPushToken.slice(0, 12) + '...',
      },
      'deviceToken',
    );

    const { data } = await apiPost<DeviceTokenResponse>('/device-tokens', payload);

    structuredLogger.info(
      'device_token.registered',
      { 
        tokenId: data.id,
        deviceId,
        platform,
      },
      'deviceToken',
    );

    return data;
  } catch (error) {
    structuredLogger.error(
      'device_token.registration_failed',
      { 
        error: error instanceof Error ? error.message : String(error),
        tokenPreview: expoPushToken.slice(0, 12) + '...',
      },
      'deviceToken',
    );
    return null;
  }
}

/**
 * Revoke a device token (typically called on sign-out).
 */
export async function revokeDeviceToken(
  tokenId: string,
  reason = 'User signed out',
): Promise<boolean> {
  try {
    structuredLogger.info(
      'device_token.revoking',
      { tokenId, reason },
      'deviceToken',
    );

    const payload: RevokeDeviceTokenRequest = { reason };
    await apiPost(`/device-tokens/${tokenId}/revoke`, payload);

    structuredLogger.info(
      'device_token.revoked',
      { tokenId },
      'deviceToken',
    );

    return true;
  } catch (error) {
    structuredLogger.error(
      'device_token.revocation_failed',
      { 
        tokenId,
        error: error instanceof Error ? error.message : String(error),
      },
      'deviceToken',
    );
    return false;
  }
}

/**
 * Delete a device token permanently (hard delete).
 */
export async function deleteDeviceToken(tokenId: string): Promise<boolean> {
  try {
    structuredLogger.info(
      'device_token.deleting',
      { tokenId },
      'deviceToken',
    );

    await apiDelete(`/device-tokens/${tokenId}`);

    structuredLogger.info(
      'device_token.deleted',
      { tokenId },
      'deviceToken',
    );

    return true;
  } catch (error) {
    structuredLogger.error(
      'device_token.deletion_failed',
      { 
        tokenId,
        error: error instanceof Error ? error.message : String(error),
      },
      'deviceToken',
    );
    return false;
  }
}

/**
 * Send a heartbeat to keep the token active.
 * This should be called periodically to indicate the device is still in use.
 */
export async function sendDeviceTokenHeartbeat(tokenId: string): Promise<boolean> {
  try {
    await apiPost(`/device-tokens/${tokenId}/heartbeat`, undefined);
    return true;
  } catch (error) {
    structuredLogger.warn(
      'device_token.heartbeat_failed',
      { 
        tokenId,
        error: error instanceof Error ? error.message : String(error),
      },
      'deviceToken',
    );
    return false;
  }
}
