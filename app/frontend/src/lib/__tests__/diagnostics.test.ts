import {
  sanitizeClientString,
  sanitizePublicKey,
  sanitizeClientData,
  recordClientError,
  getClientErrors,
  collectBatteryDiagnostics,
  generateDeviceDiagnostics,
  DEFAULT_BATTERY_THRESHOLD,
} from '../diagnostics';

jest.mock('../walletStore', () => ({
  useWalletStore: {
    getState: () => ({ publicKey: null, network: 'testnet' }),
  },
}));

jest.mock('../app-role', () => ({
  getAppUserRole: () => 'viewer',
}));

describe('Frontend Diagnostics Utility', () => {
  describe('sanitizeClientString', () => {
    it('should redact secret key patterns', () => {
      const secret = 'S1234567890123456789012345678901234567890123456789012345';
      const input = `Wallet seed: ${secret}`;
      const sanitized = sanitizeClientString(input);
      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain('[REDACTED]');
    });

    it('should redact Bearer tokens', () => {
      const input = 'Authorization: Bearer my.jwt.token';
      const sanitized = sanitizeClientString(input);
      expect(sanitized).not.toContain('my.jwt.token');
      expect(sanitized).toContain('[REDACTED]');
    });
  });

  describe('sanitizePublicKey', () => {
    it('should mask full public key to first 6 and last 6 characters', () => {
      const key = 'GABC12345678901234567890123456789012345678901234567890XYZ';
      const sanitized = sanitizePublicKey(key);
      expect(sanitized).toBe('GABC12...890XYZ');
    });

    it('should return null if input key is null', () => {
      expect(sanitizePublicKey(null)).toBeNull();
    });
  });

  describe('sanitizeClientData', () => {
    it('should recursively redact sensitive fields in objects', () => {
      const payload = {
        appVersion: '1.0.0',
        user: {
          email: 'recipient@domain.com',
          password: 'pass123password',
        },
      };

      const result = sanitizeClientData(payload);
      expect(result.appVersion).toBe('1.0.0');
      expect(result.user.email).toBe('[REDACTED]');
      expect(result.user.password).toBe('[REDACTED]');
    });
  });

  describe('recordClientError', () => {
    it('should push sanitized error messages into client error log buffer', () => {
      recordClientError('Failed request with token secret_9999', 'unit-test');
      const errors = getClientErrors();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('[REDACTED]');
      expect(errors[0].source).toBe('unit-test');
    });
  });
});

describe('Battery diagnostics in export', () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    jest.restoreAllMocks();
  });

  it('collectBatteryDiagnostics reports level, threshold, and deferral state', async () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        getBattery: async () => ({ level: 0.15, charging: false }),
      },
      configurable: true,
      writable: true,
    });

    const battery = await collectBatteryDiagnostics();
    expect(battery.available).toBe(true);
    expect(battery.level).toBe(0.15);
    expect(battery.levelPercent).toBe(15);
    expect(battery.charging).toBe(false);
    expect(battery.batteryThreshold).toBe(DEFAULT_BATTERY_THRESHOLD);
    expect(battery.syncDeferredForBattery).toBe(true);
  });

  it('generateDeviceDiagnostics includes battery fields in the exported bundle', async () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'jest',
        language: 'en-US',
        getBattery: async () => ({ level: 0.42, charging: true }),
      },
      configurable: true,
      writable: true,
    });

    const fetchMock = jest.fn().mockRejectedValue(new Error('offline'));
    // @ts-expect-error test shim
    global.fetch = fetchMock;

    const bundle = await generateDeviceDiagnostics();
    expect(bundle.battery).toBeDefined();
    expect(bundle.battery.available).toBe(true);
    expect(bundle.battery.levelPercent).toBe(42);
    expect(bundle.battery.batteryThreshold).toBe(DEFAULT_BATTERY_THRESHOLD);
    expect(bundle.battery.syncDeferredForBattery).toBe(false);
    expect(JSON.stringify(bundle)).toContain('"batteryThreshold"');
    expect(JSON.stringify(bundle)).toContain('"syncDeferredForBattery"');
  });
});
