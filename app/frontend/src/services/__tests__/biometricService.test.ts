import {
  checkBiometricAvailability,
  authenticateBiometric,
  getBiometricStatus,
  BiometricCapabilities,
  BiometricAuthResult
} from '../biometricService';

// Mock environment variables
const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('biometricService', () => {
  describe('checkBiometricAvailability', () => {
    it('returns available capabilities when MOCK_BIOMETRIC_AVAILABLE is true', async () => {
      process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_AVAILABLE = 'true';
      
      const capabilities = await checkBiometricAvailability();
      
      expect(capabilities.isAvailable).toBe(true);
      expect(capabilities.type).toBe('webauthn');
      expect(capabilities.description).toContain('Mock biometric authentication');
    });

    it('returns unavailable capabilities when MOCK_BIOMETRIC_AVAILABLE is false', async () => {
      process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_AVAILABLE = 'false';
      
      const capabilities = await checkBiometricAvailability();
      
      expect(capabilities.isAvailable).toBe(false);
      expect(capabilities.type).toBe('none');
      expect(capabilities.description).toContain('not available');
    });

    it('defaults to available when env var is not set', async () => {
      delete process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_AVAILABLE;
      
      const capabilities = await checkBiometricAvailability();
      
      expect(capabilities.isAvailable).toBe(true);
    });
  });

  describe('authenticateBiometric', () => {
    it('returns success when MOCK_BIOMETRIC_OUTCOME is success', async () => {
      process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_OUTCOME = 'success';
      
      const result = await authenticateBiometric();
      
      expect(result).toBe('success');
    });

    it('returns failed when MOCK_BIOMETRIC_OUTCOME is failed', async () => {
      process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_OUTCOME = 'failed';
      
      const result = await authenticateBiometric();
      
      expect(result).toBe('failed');
    });

    it('returns cancelled when MOCK_BIOMETRIC_OUTCOME is cancelled', async () => {
      process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_OUTCOME = 'cancelled';
      
      const result = await authenticateBiometric();
      
      expect(result).toBe('cancelled');
    });

    it('returns error when MOCK_BIOMETRIC_OUTCOME is error', async () => {
      process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_OUTCOME = 'error';
      
      const result = await authenticateBiometric();
      
      expect(result).toBe('error');
    });

    it('simulates random outcomes when no env var is set', async () => {
      delete process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_OUTCOME;
      
      // Test multiple times to ensure random distribution
      const results = new Set();
      for (let i = 0; i < 10; i++) {
        const result = await authenticateBiometric();
        results.add(result);
      }
      
      // Should have at least one success (80% probability)
      expect(results.has('success')).toBe(true);
      // Could have failed or cancelled (10% each)
      expect(results.size).toBeGreaterThanOrEqual(1);
    });

    it('accepts custom reason and timeout', async () => {
      const reason = 'Custom test reason';
      const timeout = 5000;
      
      const result = await authenticateBiometric({ reason, timeout });
      
      expect(result).toBeDefined();
      // Just ensure it doesn't throw with custom options
    });
  });

  describe('getBiometricStatus', () => {
    it('returns available when biometrics are available', async () => {
      process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_AVAILABLE = 'true';
      
      const status = await getBiometricStatus();
      
      expect(status).toBe('available');
    });

    it('returns unavailable when biometrics are not available', async () => {
      process.env.NEXT_PUBLIC_MOCK_BIOMETRIC_AVAILABLE = 'false';
      
      const status = await getBiometricStatus();
      
      expect(status).toBe('unavailable');
    });

    it('returns unknown on error', async () => {
      // Mock checkBiometricAvailability to throw
      jest.doMock('../biometricService', () => ({
        checkBiometricAvailability: jest.fn().mockRejectedValue(new Error('Test error')),
        getBiometricStatus: require.requireActual('../biometricService').getBiometricStatus
      }));
      
      const { getBiometricStatus: getStatus } = require('../biometricService');
      const status = await getStatus();
      
      expect(status).toBe('unknown');
    });
  });
});