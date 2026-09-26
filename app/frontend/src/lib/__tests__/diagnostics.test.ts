import {
  sanitizeClientString,
  sanitizePublicKey,
  sanitizeClientData,
  recordClientError,
  getClientErrors,
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
