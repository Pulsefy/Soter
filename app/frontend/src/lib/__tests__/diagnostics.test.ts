import {
  sanitizeClientString,
  sanitizePublicKey,
  sanitizeClientData,
  recordClientError,
  getClientErrors,
  generateDeviceDiagnostics,
  buildBatteryDiagnostics,
  DEFAULT_BATTERY_THRESHOLD,
} from '../diagnostics';

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

describe('Battery diagnostics reporting', () => {
  const originalFetch = globalThis.fetch;
  const originalThreshold = process.env.NEXT_PUBLIC_BATTERY_THRESHOLD;

  // Keep the export builder offline/deterministic: backend diagnostics simply
  // report as unavailable instead of hitting the network.
  beforeEach(() => {
    globalThis.fetch = (async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalThreshold === undefined) {
      delete process.env.NEXT_PUBLIC_BATTERY_THRESHOLD;
    } else {
      process.env.NEXT_PUBLIC_BATTERY_THRESHOLD = originalThreshold;
    }
  });

  describe('buildBatteryDiagnostics', () => {
    it('flags battery-aware sync deferral below the threshold when not charging', () => {
      const battery = buildBatteryDiagnostics({ level: 0.15, charging: false }, 0.2);
      expect(battery.available).toBe(true);
      expect(battery.level).toBeCloseTo(0.15);
      expect(battery.levelPercent).toBe(15);
      expect(battery.batteryThreshold).toBe(0.2);
      expect(battery.batteryThresholdPercent).toBe(20);
      expect(battery.syncDeferredForBattery).toBe(true);
    });

    it('does not flag deferral at the threshold boundary (level === threshold)', () => {
      const battery = buildBatteryDiagnostics({ level: 0.2, charging: false }, 0.2);
      expect(battery.syncDeferredForBattery).toBe(false);
    });

    it('does not flag deferral while charging below the threshold', () => {
      const battery = buildBatteryDiagnostics({ level: 0.05, charging: true }, 0.2);
      expect(battery.charging).toBe(true);
      expect(battery.syncDeferredForBattery).toBe(false);
    });

    it('reports an unavailable battery without losing the configured threshold', () => {
      const battery = buildBatteryDiagnostics(null);
      expect(battery.available).toBe(false);
      expect(battery.level).toBeNull();
      expect(battery.levelPercent).toBeNull();
      expect(battery.charging).toBeNull();
      expect(battery.syncDeferredForBattery).toBeNull();
      expect(battery.batteryThreshold).toBe(DEFAULT_BATTERY_THRESHOLD);
      expect(battery.batteryThresholdPercent).toBe(20);
    });
  });

  describe('generateDeviceDiagnostics export payload', () => {
    it('includes the battery fields in a real produced export bundle', async () => {
      delete process.env.NEXT_PUBLIC_BATTERY_THRESHOLD;
      const bundle = await generateDeviceDiagnostics({
        batteryReader: async () => ({ level: 0.15, charging: false }),
      });

      expect(bundle.battery).toBeDefined();
      expect(bundle.battery.available).toBe(true);
      expect(bundle.battery.levelPercent).toBe(15);
      expect(bundle.battery.charging).toBe(false);
      expect(bundle.battery.batteryThreshold).toBe(DEFAULT_BATTERY_THRESHOLD);
      expect(bundle.battery.batteryThresholdPercent).toBe(20);
      expect(bundle.battery.syncDeferredForBattery).toBe(true);

      // The fields survive serialization of the actual export object.
      const serialized = JSON.parse(JSON.stringify(bundle));
      expect(serialized.battery.levelPercent).toBe(15);
      expect(serialized.battery.syncDeferredForBattery).toBe(true);
      expect(serialized.battery.batteryThresholdPercent).toBe(20);
    });

    it('honours a valid NEXT_PUBLIC_BATTERY_THRESHOLD and ignores invalid values', async () => {
      process.env.NEXT_PUBLIC_BATTERY_THRESHOLD = '0.5';
      let bundle = await generateDeviceDiagnostics({
        batteryReader: async () => ({ level: 0.3, charging: false }),
      });
      expect(bundle.battery.batteryThreshold).toBe(0.5);
      expect(bundle.battery.batteryThresholdPercent).toBe(50);
      expect(bundle.battery.syncDeferredForBattery).toBe(true);

      process.env.NEXT_PUBLIC_BATTERY_THRESHOLD = 'not-a-number';
      bundle = await generateDeviceDiagnostics({
        batteryReader: async () => ({ level: 0.3, charging: false }),
      });
      expect(bundle.battery.batteryThreshold).toBe(DEFAULT_BATTERY_THRESHOLD);
      expect(bundle.battery.syncDeferredForBattery).toBe(false);
    });

    it('marks the battery as unavailable when the reader returns nothing', async () => {
      const bundle = await generateDeviceDiagnostics({ batteryReader: async () => null });
      expect(bundle.battery.available).toBe(false);
      expect(bundle.battery.level).toBeNull();
      expect(bundle.battery.syncDeferredForBattery).toBeNull();
      expect(bundle.battery.batteryThresholdPercent).toBe(20);
    });
  });
});
