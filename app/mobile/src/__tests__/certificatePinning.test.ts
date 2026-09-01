import type { AppConfig } from '../config';
import {
  CertificatePinningError,
  getHostnameFromUrl,
  isLocalBackendHostname,
  initializeCertificatePinning,
  guardAgainstPinningFailure,
} from '../services/certificatePinning';

const mockIsSslPinningAvailable = jest.fn();
const mockInitializeSslPinning = jest.fn();
const mockDisableSslPinning = jest.fn();
const mockAddSslPinningErrorListener = jest.fn();

jest.mock('react-native-ssl-public-key-pinning', () => ({
  isSslPinningAvailable: (...args: unknown[]) => mockIsSslPinningAvailable(...args),
  initializeSslPinning: (...args: unknown[]) => mockInitializeSslPinning(...args),
  disableSslPinning: (...args: unknown[]) => mockDisableSslPinning(...args),
  addSslPinningErrorListener: (...args: unknown[]) => mockAddSslPinningErrorListener(...args),
}));

const baseConfig: AppConfig = {
  apiUrl: 'https://api.soter.org',
  envName: 'prod',
  network: 'mainnet',
  walletConnectProjectId: 'wc-id',
  certPinHashes: ['primary-hash==', 'backup-hash=='],
  certPinIncludeSubdomains: false,
  isValid: true,
  errors: [],
};

describe('certificatePinning', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockIsSslPinningAvailable.mockReset().mockReturnValue(true);
    mockInitializeSslPinning.mockReset().mockResolvedValue(undefined);
    mockDisableSslPinning.mockReset().mockResolvedValue(undefined);
    mockAddSslPinningErrorListener.mockReset().mockReturnValue({ remove: jest.fn() });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getHostnameFromUrl', () => {
    it('extracts the hostname from a valid URL', () => {
      expect(getHostnameFromUrl('https://api.soter.org/health')).toBe('api.soter.org');
    });

    it('returns null for a malformed URL', () => {
      expect(getHostnameFromUrl('not-a-url')).toBeNull();
    });
  });

  describe('isLocalBackendHostname', () => {
    it.each(['localhost', '127.0.0.1', '10.0.2.2', '::1'])('treats %s as a local backend', (host) => {
      expect(isLocalBackendHostname(host)).toBe(true);
    });

    it('treats a real domain as non-local', () => {
      expect(isLocalBackendHostname('api.soter.org')).toBe(false);
    });

    it('treats null as non-local', () => {
      expect(isLocalBackendHostname(null)).toBe(false);
    });
  });

  describe('initializeCertificatePinning', () => {
    it('skips initialization when the native module is unavailable', async () => {
      mockIsSslPinningAvailable.mockReturnValue(false);
      await initializeCertificatePinning(baseConfig);
      expect(mockInitializeSslPinning).not.toHaveBeenCalled();
      expect(mockDisableSslPinning).not.toHaveBeenCalled();
    });

    it('disables pinning for a local/emulator backend', async () => {
      await initializeCertificatePinning({ ...baseConfig, apiUrl: 'http://10.0.2.2:3000' });
      expect(mockDisableSslPinning).toHaveBeenCalled();
      expect(mockInitializeSslPinning).not.toHaveBeenCalled();
    });

    it('skips initialization when fewer than 2 pin hashes are configured', async () => {
      await initializeCertificatePinning({ ...baseConfig, certPinHashes: ['only-one=='] });
      expect(mockInitializeSslPinning).not.toHaveBeenCalled();
    });

    it('initializes pinning with the configured host and pins', async () => {
      await initializeCertificatePinning(baseConfig);
      expect(mockInitializeSslPinning).toHaveBeenCalledWith({
        'api.soter.org': {
          includeSubdomains: false,
          publicKeyHashes: ['primary-hash==', 'backup-hash=='],
        },
      });
    });

    it('registers a pin-mismatch error listener', async () => {
      await initializeCertificatePinning(baseConfig);
      expect(mockAddSslPinningErrorListener).toHaveBeenCalled();
    });

    it('logs and does not throw when native initialization rejects', async () => {
      mockInitializeSslPinning.mockRejectedValue(new Error('TrustKit requires 2 pins'));
      await expect(initializeCertificatePinning(baseConfig)).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('guardAgainstPinningFailure', () => {
    it('rethrows the original error when no pin mismatch was reported', () => {
      const original = new Error('Network request failed');
      expect(() => guardAgainstPinningFailure('https://api.soter.org/health', original)).toThrow(original);
    });

    it('throws a CertificatePinningError when a recent pin mismatch was reported for the host', async () => {
      await initializeCertificatePinning(baseConfig);
      const errorListener = mockAddSslPinningErrorListener.mock.calls[0][0] as (error: {
        serverHostname: string;
      }) => void;

      errorListener({ serverHostname: 'api.soter.org' });

      const original = new Error('Network request failed');
      expect(() => guardAgainstPinningFailure('https://api.soter.org/health', original)).toThrow(
        CertificatePinningError,
      );
    });

    it('does not attribute a pin mismatch on a different host', async () => {
      await initializeCertificatePinning(baseConfig);
      const errorListener = mockAddSslPinningErrorListener.mock.calls[0][0] as (error: {
        serverHostname: string;
      }) => void;

      errorListener({ serverHostname: 'evil.example.com' });

      const original = new Error('Network request failed');
      expect(() => guardAgainstPinningFailure('https://api.soter.org/health', original)).toThrow(original);
    });

    it('stops attributing a pin mismatch once the attribution window elapses', async () => {
      jest.useFakeTimers();
      await initializeCertificatePinning(baseConfig);
      const errorListener = mockAddSslPinningErrorListener.mock.calls[0][0] as (error: {
        serverHostname: string;
      }) => void;

      errorListener({ serverHostname: 'api.soter.org' });
      jest.advanceTimersByTime(6000);

      const original = new Error('Network request failed');
      expect(() => guardAgainstPinningFailure('https://api.soter.org/health', original)).toThrow(original);
    });
  });
});
