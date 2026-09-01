import * as LocalAuthentication from 'expo-local-authentication';
import {
  confirmValueMovingAction,
  getValueActionConfirmationCacheMs,
  resetValueActionConfirmationCache,
} from '../services/valueActionConfirmation';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

const mockedLocalAuthentication = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

const getProcessEnv = (): Record<string, string | undefined> => {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };

  if (!globalWithProcess.process) {
    globalWithProcess.process = { env: {} };
  }

  if (!globalWithProcess.process.env) {
    globalWithProcess.process.env = {};
  }

  return globalWithProcess.process.env;
};

describe('confirmValueMovingAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    resetValueActionConfirmationCache();
    delete getProcessEnv().EXPO_PUBLIC_VALUE_ACTION_CONFIRMATION_CACHE_MS;

    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(true);
    mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(true);
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: true,
    } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns success when device confirmation succeeds', async () => {
    const result = await confirmValueMovingAction('Confirm claim');

    expect(result).toEqual({ ok: true, cached: false });
    expect(mockedLocalAuthentication.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        promptMessage: 'Confirm claim',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      }),
    );
  });

  it('uses the confirmation cache window to avoid repeated prompts', async () => {
    const first = await confirmValueMovingAction('Confirm claim');
    const second = await confirmValueMovingAction('Confirm claim');

    expect(first).toEqual({ ok: true, cached: false });
    expect(second).toEqual({ ok: true, cached: true });
    expect(mockedLocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  });

  it('aborts when the confirmation is cancelled', async () => {
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: false,
      error: 'user_cancel',
    } as any);

    const result = await confirmValueMovingAction('Confirm claim');

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('supports passcode fallback on devices without biometric enrollment', async () => {
    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(false);
    mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(false);
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: true,
    } as any);

    const result = await confirmValueMovingAction('Confirm claim');

    expect(result).toEqual({ ok: true, cached: false });
    expect(mockedLocalAuthentication.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
  });

  it('returns failure when no biometric hardware exists and device fallback is unavailable', async () => {
    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(false);
    mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(false);
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: false,
      error: 'not_available',
    } as any);

    const result = await confirmValueMovingAction('Confirm claim');

    expect(result).toEqual({ ok: false, reason: 'failed' });
  });

  it('reads a configurable cache window from env', () => {
    getProcessEnv().EXPO_PUBLIC_VALUE_ACTION_CONFIRMATION_CACHE_MS = '15000';

    expect(getValueActionConfirmationCacheMs()).toBe(15000);
  });
});
