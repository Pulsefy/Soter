import {
  checkBiometricAvailability,
  authenticateBiometric,
  getBiometricStatus,
  registerPasskey,
  listRegisteredPasskeys,
  BiometricCapabilities,
  BiometricAuthResult,
} from '../biometricService';

// ---------------------------------------------------------------------------
// Mock browser WebAuthn APIs
// ---------------------------------------------------------------------------

const mockIsUserVerifyingPlatformAuthenticatorAvailable = jest.fn();
const mockCredentialsCreate = jest.fn();
const mockCredentialsGet = jest.fn();
const mockFetch = jest.fn();

beforeAll(() => {
  // Mock PublicKeyCredential
  (globalThis as any).PublicKeyCredential = {
    isUserVerifyingPlatformAuthenticatorAvailable:
      mockIsUserVerifyingPlatformAuthenticatorAvailable,
  };

  // Mock navigator.credentials
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      credentials: {
        create: mockCredentialsCreate,
        get: mockCredentialsGet,
      },
    },
    writable: true,
  });

  // Mock window
  (globalThis as any).window = globalThis;

  // Mock fetch
  (globalThis as any).fetch = mockFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('biometricService (WebAuthn)', () => {
  describe('checkBiometricAvailability', () => {
    it('returns available when platform authenticator is supported', async () => {
      mockIsUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(true);

      const capabilities = await checkBiometricAvailability();

      expect(capabilities.isAvailable).toBe(true);
      expect(capabilities.type).toBe('webauthn');
      expect(capabilities.description).toContain('WebAuthn');
    });

    it('returns unavailable when platform authenticator is not supported', async () => {
      mockIsUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(false);

      const capabilities = await checkBiometricAvailability();

      expect(capabilities.isAvailable).toBe(false);
      expect(capabilities.type).toBe('none');
    });

    it('returns unavailable when PublicKeyCredential is undefined', async () => {
      const originalPKC = (globalThis as any).PublicKeyCredential;
      delete (globalThis as any).PublicKeyCredential;

      const capabilities = await checkBiometricAvailability();

      expect(capabilities.isAvailable).toBe(false);
      expect(capabilities.type).toBe('none');

      // Restore
      (globalThis as any).PublicKeyCredential = originalPKC;
    });
  });

  describe('getBiometricStatus', () => {
    it('returns "available" when platform authenticator is supported', async () => {
      mockIsUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(true);

      const status = await getBiometricStatus();

      expect(status).toBe('available');
    });

    it('returns "unavailable" when platform authenticator is not supported', async () => {
      mockIsUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(false);

      const status = await getBiometricStatus();

      expect(status).toBe('unavailable');
    });
  });

  describe('registerPasskey', () => {
    it('calls server for options, creates credential, and verifies', async () => {
      // Mock registration options response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          challenge: 'dGVzdC1jaGFsbGVuZ2U', // base64url of "test-challenge"
          rpId: 'localhost',
          rpName: 'Soter',
          userId: 'dXNlcjE', // base64url of "user1"
          userName: 'user@example.com',
          userDisplayName: 'user@example.com',
          authenticatorAttachment: 'platform',
          timeout: 60000,
          attestation: 'none',
          challengeId: 'challenge-123',
        }),
      });

      // Mock navigator.credentials.create()
      const mockCredential = {
        rawId: new Uint8Array([1, 2, 3, 4]).buffer,
        response: {
          attestationObject: new Uint8Array([5, 6, 7]).buffer,
          clientDataJSON: new Uint8Array([8, 9, 10]).buffer,
        },
        authenticatorAttachment: 'platform',
      };
      mockCredentialsCreate.mockResolvedValue(mockCredential);

      // Mock verify response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          credentialId: 'cred-123',
          message: 'Passkey registered successfully',
        }),
      });

      const result = await registerPasskey('user@example.com', 'My Laptop');

      expect(result.success).toBe(true);
      expect(result.credentialId).toBe('cred-123');
      expect(mockCredentialsCreate).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns cancelled when user dismisses the prompt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          challenge: 'dGVzdA',
          rpId: 'localhost',
          rpName: 'Soter',
          userId: 'dXNlcjE',
          userName: 'user@example.com',
          userDisplayName: 'user@example.com',
          authenticatorAttachment: 'platform',
          timeout: 60000,
          attestation: 'none',
          challengeId: 'challenge-456',
        }),
      });

      const error = new DOMException('User cancelled', 'NotAllowedError');
      mockCredentialsCreate.mockRejectedValue(error);

      const result = await registerPasskey('user@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toContain('cancelled');
    });
  });

  describe('authenticateBiometric', () => {
    it('completes full authentication flow', async () => {
      // Mock auth options response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          challenge: 'YXV0aC1jaGFsbGVuZ2U',
          rpId: 'localhost',
          timeout: 60000,
          allowCredentials: [
            { id: 'Y3JlZC0x', type: 'public-key', transports: ['internal'] },
          ],
          userVerification: 'preferred',
          challengeId: 'auth-challenge-123',
        }),
      });

      // Mock navigator.credentials.get()
      const mockAssertion = {
        rawId: new Uint8Array([1, 2, 3, 4]).buffer,
        response: {
          authenticatorData: new Uint8Array([11, 12]).buffer,
          clientDataJSON: new Uint8Array([13, 14]).buffer,
          signature: new Uint8Array([15, 16]).buffer,
          userHandle: new Uint8Array([17, 18]).buffer,
        },
      };
      mockCredentialsGet.mockResolvedValue(mockAssertion);

      // Mock verify response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          userId: 'user-1',
          email: 'user@example.com',
          role: 'admin',
          message: 'Authentication successful',
        }),
      });

      const result = await authenticateBiometric({ email: 'user@example.com' });

      expect(result).toBe('success');
      expect(mockCredentialsGet).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns "cancelled" when user dismisses the prompt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          challenge: 'YXV0aA',
          rpId: 'localhost',
          timeout: 60000,
          allowCredentials: [],
          userVerification: 'preferred',
          challengeId: 'auth-challenge-456',
        }),
      });

      const error = new DOMException('User cancelled', 'NotAllowedError');
      mockCredentialsGet.mockRejectedValue(error);

      const result = await authenticateBiometric();

      expect(result).toBe('cancelled');
    });

    it('returns "failed" when server rejects the assertion', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          challenge: 'YXV0aA',
          rpId: 'localhost',
          timeout: 60000,
          allowCredentials: [],
          userVerification: 'preferred',
          challengeId: 'auth-challenge-789',
        }),
      });

      mockCredentialsGet.mockResolvedValue({
        rawId: new Uint8Array([1, 2]).buffer,
        response: {
          authenticatorData: new Uint8Array([3]).buffer,
          clientDataJSON: new Uint8Array([4]).buffer,
          signature: new Uint8Array([5]).buffer,
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Assertion verification failed',
      });

      const result = await authenticateBiometric();

      expect(result).toBe('failed');
    });

    it('returns "error" when server options call fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Server error' }),
      });

      const result = await authenticateBiometric();

      expect(result).toBe('error');
    });
  });

  describe('listRegisteredPasskeys', () => {
    it('fetches credentials for a user', async () => {
      const mockCredentials = [
        {
          id: '1',
          credentialId: 'cred-1',
          attachment: 'platform',
          label: 'My Laptop',
          verified: true,
          createdAt: '2025-01-01T00:00:00Z',
          lastUsedAt: null,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCredentials,
      });

      const result = await listRegisteredPasskeys('user@example.com');

      expect(result).toEqual(mockCredentials);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('credentials?email=user%40example.com'),
      );
    });
  });
});
