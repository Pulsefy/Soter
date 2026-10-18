import * as LocalAuthentication from 'expo-local-authentication';
import { confirmValueMovingAction, resetValueActionConfirmationCache } from '../services/valueActionConfirmation';
import { disconnectWalletSession } from '../services/walletConnect';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

jest.mock('../services/walletConnect', () => ({
  disconnectWalletSession: jest.fn(),
  restoreWalletSession: jest.fn(),
  createWalletConnection: jest.fn(),
  openWalletConnectPairingUri: jest.fn(),
}));

const mockedLocalAuthentication = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const mockedDisconnectWalletSession = disconnectWalletSession as jest.MockedFunction<typeof disconnectWalletSession>;

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

describe('Wallet Disconnect Biometric Confirmation', () => {
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

    mockedDisconnectWalletSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('disconnects wallet when biometric confirmation succeeds', async () => {
    const result = await confirmValueMovingAction('Confirm wallet disconnect');

    expect(result).toEqual({ ok: true, cached: false });
    expect(mockedLocalAuthentication.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        promptMessage: 'Confirm wallet disconnect',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      }),
    );
  });

  it('cancels wallet disconnect when user cancels biometric prompt', async () => {
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: false,
      error: 'user_cancel',
    } as any);

    const result = await confirmValueMovingAction('Confirm wallet disconnect');

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(mockedDisconnectWalletSession).not.toHaveBeenCalled();
  });

  it('cancels wallet disconnect when system cancels biometric prompt', async () => {
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: false,
      error: 'system_cancel',
    } as any);

    const result = await confirmValueMovingAction('Confirm wallet disconnect');

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(mockedDisconnectWalletSession).not.toHaveBeenCalled();
  });

  it('cancels wallet disconnect when app cancels biometric prompt', async () => {
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: false,
      error: 'app_cancel',
    } as any);

    const result = await confirmValueMovingAction('Confirm wallet disconnect');

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(mockedDisconnectWalletSession).not.toHaveBeenCalled();
  });

  it('allows wallet disconnect via passcode fallback when no biometric hardware', async () => {
    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(false);
    mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(false);
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: true,
    } as any);

    const result = await confirmValueMovingAction('Confirm wallet disconnect');

    expect(result).toEqual({ ok: true, cached: false });
    expect(mockedLocalAuthentication.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
  });

  it('blocks wallet disconnect when no biometric hardware and fallback unavailable', async () => {
    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(false);
    mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(false);
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: false,
      error: 'not_available',
    } as any);

    const result = await confirmValueMovingAction('Confirm wallet disconnect');

    expect(result).toEqual({ ok: false, reason: 'failed' });
    expect(mockedDisconnectWalletSession).not.toHaveBeenCalled();
  });

  it('returns failure when authentication throws an error', async () => {
    mockedLocalAuthentication.authenticateAsync.mockRejectedValue(new Error('Authentication failed'));

    const result = await confirmValueMovingAction('Confirm wallet disconnect');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.error).toBeInstanceOf(Error);
    expect(mockedDisconnectWalletSession).not.toHaveBeenCalled();
  });

  it('uses confirmation cache to avoid repeated prompts for disconnect', async () => {
    const first = await confirmValueMovingAction('Confirm wallet disconnect');
    const second = await confirmValueMovingAction('Confirm wallet disconnect');

    expect(first).toEqual({ ok: true, cached: false });
    expect(second).toEqual({ ok: true, cached: true });
    expect(mockedLocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  });
});