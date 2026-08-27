import * as LocalAuthentication from 'expo-local-authentication';

const DEFAULT_CONFIRMATION_CACHE_MS = 2 * 60 * 1000;

type ProcessEnvLike = {
  env?: Record<string, string | undefined>;
};

let lastConfirmationAt: number | null = null;

export type ValueActionConfirmationResult =
  | { ok: true; cached: boolean }
  | {
      ok: false;
      reason: 'cancelled' | 'failed' | 'error';
      error?: Error;
    };

const getExpoPublicEnv = (key: string): string | undefined => {
  const processLike = (globalThis as { process?: ProcessEnvLike }).process;
  return processLike?.env?.[key];
};

export const getValueActionConfirmationCacheMs = (): number => {
  const configured = Number(getExpoPublicEnv('EXPO_PUBLIC_VALUE_ACTION_CONFIRMATION_CACHE_MS'));

  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }

  return DEFAULT_CONFIRMATION_CACHE_MS;
};

export const resetValueActionConfirmationCache = (): void => {
  lastConfirmationAt = null;
};

const isWithinCacheWindow = (now: number, cacheMs: number): boolean => {
  if (lastConfirmationAt == null) return false;
  return now - lastConfirmationAt < cacheMs;
};

export const confirmValueMovingAction = async (
  promptMessage = 'Confirm this claim action',
): Promise<ValueActionConfirmationResult> => {
  const cacheMs = getValueActionConfirmationCacheMs();
  const now = Date.now();

  if (isWithinCacheWindow(now, cacheMs)) {
    return { ok: true, cached: true };
  }

  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });

    if (result.success) {
      lastConfirmationAt = now;
      return { ok: true, cached: false };
    }

    if (!hasHardware || !isEnrolled) {
      return { ok: false, reason: 'failed' };
    }

    return {
      ok: false,
      reason:
        result.error === 'user_cancel' || result.error === 'system_cancel' || result.error === 'app_cancel'
          ? 'cancelled'
          : 'failed',
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      error: error instanceof Error ? error : new Error('Authentication failed'),
    };
  }
};
