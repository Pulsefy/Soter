/**
 * @jest-environment jsdom
 */

import {
  checkBiometricAvailability,
  authenticateBiometric,
  registerWebauthn,
  getBiometricStatus,
  promptBiometricAuthentication,
} from '../biometricService';
import { fetchClient } from '@/lib/mock-api/client';

jest.mock('@/lib/mock-api/client', () => ({
  fetchClient: jest.fn(),
}));

const mockedFetchClient = fetchClient as jest.MockedFunction<typeof fetchClient>;

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeChallenge(): string {
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) arr[i] = i;
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fakeCredentialResponse(kind: 'create' | 'get') {
  const rawId = new Uint8Array(16);
  for (let i = 0; i < 16; i++) rawId[i] = i + 1;

  const clientData = JSON.stringify({ type: kind === 'create' ? 'webauthn.create' : 'webauthn.get', challenge: fakeChallenge(), origin: 'http://localhost' });
  const clientDataBytes = new TextEncoder().encode(clientData);

  const attestationObj = new Uint8Array([0xa0]);
  const authData = new Uint8Array(37);
  const signature = new Uint8Array(72);

  const responseCommon = {
    clientDataJSON: clientDataBytes.buffer,
  };

  return {
    id: 'test-credential-id',
    rawId: rawId.buffer,
    type: 'public-key' as const,
    authenticatorAttachment: 'platform' as AuthenticatorAttachment,
    response: kind === 'create'
      ? {
          ...responseCommon,
          attestationObject: attestationObj.buffer,
          getTransports: () => ['internal'],
          getPublicKey: () => null,
          getPublicKeyAlgorithm: () => -7,
          getAuthenticatorData: () => authData.buffer,
        } as unknown as AuthenticatorAttestationResponse
      : {
          ...responseCommon,
          authenticatorData: authData.buffer,
          signature: signature.buffer,
          userHandle: null,
        } as unknown as AuthenticatorAssertionResponse,
    getClientExtensionResults: () => ({}),
  };
}

describe('biometricService (WebAuthn)', () => {
  let originalPublicKeyCredential: typeof window.PublicKeyCredential | undefined;
  let originalCredentials: typeof navigator.credentials | undefined;

  beforeEach(() => {
    jest.resetAllMocks();
    originalPublicKeyCredential = window.PublicKeyCredential;
    originalCredentials = navigator.credentials;
  });

  afterEach(() => {
    if (originalPublicKeyCredential === undefined) {
      delete (window as Partial<Window>).PublicKeyCredential;
    } else {
      window.PublicKeyCredential = originalPublicKeyCredential;
    }
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      writable: true,
      value: originalCredentials,
    });
  });

  describe('unsupported environments', () => {
    it('returns unavailable when run outside a browser (simulated via no window globals)', async () => {
      delete (window as Partial<Window>).PublicKeyCredential;
      (navigator.credentials as unknown) = undefined;

      const caps = await checkBiometricAvailability();

      expect(caps.isAvailable).toBe(false);
      expect(caps.type).toBe('none');
      expect(caps.webauthnSupported).toBe(false);
      expect(caps.description).toContain('does not support WebAuthn');
    });

    it('returns unavailable when isUserVerifyingPlatformAuthenticatorAvailable is absent', async () => {
      window.PublicKeyCredential = class FakeEmpty {} as typeof window.PublicKeyCredential;

      const caps = await checkBiometricAvailability();

      expect(caps.isAvailable).toBe(false);
      expect(caps.webauthnSupported).toBe(false);
    });

    it('returns unavailable when platform authenticator NOT enrolled (uvpaa=false)', async () => {
      window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockResolvedValue(false),
      } as unknown as typeof window.PublicKeyCredential;

      const caps = await checkBiometricAvailability();

      expect(caps.isAvailable).toBe(false);
      expect(caps.type).toBe('none');
      expect(caps.webauthnSupported).toBe(true);
      expect(caps.description).toContain('not have a user-verifying');
    });

    it('getBiometricStatus returns unavailable when unsupported', async () => {
      delete (window as Partial<Window>).PublicKeyCredential;

      const status = await getBiometricStatus();

      expect(status).toBe('unavailable');
    });

    it('authenticateBiometric returns "error" in unsupported browsers', async () => {
      delete (window as Partial<Window>).PublicKeyCredential;

      const result = await authenticateBiometric({ userId: 'u1' });

      expect(result).toBe('error');
      expect(mockedFetchClient).not.toHaveBeenCalled();
    });
  });

  describe('availability detection', () => {
    it('returns available with inferred type when platform authenticator enrolled', async () => {
      window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockResolvedValue(true),
      } as unknown as typeof window.PublicKeyCredential;
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        writable: true,
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit Safari',
      });

      const caps = await checkBiometricAvailability();

      expect(caps.isAvailable).toBe(true);
      expect(caps.type).toBe('face_id');
      expect(caps.webauthnSupported).toBe(true);
    });

    it('handles unexpected errors during availability check', async () => {
      window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockRejectedValue(new Error('boom')),
      } as unknown as typeof window.PublicKeyCredential;

      const caps = await checkBiometricAvailability();

      expect(caps.isAvailable).toBe(false);
      expect(caps.type).toBe('none');
      expect(caps.webauthnSupported).toBe(true);
    });

    it('defaults type to generic webauthn when UA does not match known platforms', async () => {
      window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockResolvedValue(true),
      } as unknown as typeof window.PublicKeyCredential;
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        writable: true,
        value: 'SomeUnknownBot/1.0',
      });

      const caps = await checkBiometricAvailability();

      expect(caps.isAvailable).toBe(true);
      expect(caps.type).toBe('webauthn');
    });
  });

  describe('registration flow (registerWebauthn)', () => {
    function setupEnrolledEnvironment() {
      window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockResolvedValue(true),
      } as unknown as typeof window.PublicKeyCredential;
    }

    it('returns success when registration flow completes (server verifies)', async () => {
      setupEnrolledEnvironment();
      mockedFetchClient
        .mockResolvedValueOnce(jsonResponse({
          challenge: fakeChallenge(),
          rp: { name: 'Soter', id: 'localhost' },
          user: { id: 'dGVzdC11c2Vy', name: 'demo', displayName: 'Demo' },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          timeout: 60000,
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        }))
        .mockResolvedValueOnce(jsonResponse({ verified: true, credentialId: 'test-credential-id', message: 'OK' }));

      const fake = fakeCredentialResponse('create');
      navigator.credentials = {
        create: jest.fn().mockResolvedValue(fake),
        get: jest.fn(),
      } as unknown as typeof navigator.credentials;

      const result = await registerWebauthn({ username: 'demo', userId: 'u1' });

      expect(result).toBe('success');
      expect(mockedFetchClient).toHaveBeenCalledTimes(2);
      expect(mockedFetchClient.mock.calls[0][0]).toContain('/auth/webauthn/register/options');
      expect(mockedFetchClient.mock.calls[1][0]).toContain('/auth/webauthn/register/verify');
      expect(navigator.credentials.create).toHaveBeenCalledTimes(1);
    });

    it('returns "cancelled" when user dismisses the OS platform prompt', async () => {
      setupEnrolledEnvironment();
      mockedFetchClient.mockResolvedValueOnce(jsonResponse({
        challenge: fakeChallenge(),
        rp: { name: 'Soter', id: 'localhost' },
        user: { id: 'dGVzdA', name: 'demo', displayName: 'Demo' },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      }));

      const notAllowed = new DOMException('User cancelled', 'NotAllowedError');
      navigator.credentials = {
        create: jest.fn().mockRejectedValue(notAllowed),
        get: jest.fn(),
      } as unknown as typeof navigator.credentials;

      const result = await registerWebauthn();

      expect(result).toBe('cancelled');
    });

    it('returns "cancelled" when prompt is aborted via AbortSignal', async () => {
      setupEnrolledEnvironment();
      mockedFetchClient.mockResolvedValueOnce(jsonResponse({
        challenge: fakeChallenge(),
        rp: { name: 'Soter' },
        user: { id: 'dGVzdA', name: 'x', displayName: 'X' },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      }));
      navigator.credentials = {
        create: jest.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
        get: jest.fn(),
      } as unknown as typeof navigator.credentials;

      expect(await registerWebauthn()).toBe('cancelled');
    });

    it('returns "failed" when server responds with verification failure', async () => {
      setupEnrolledEnvironment();
      mockedFetchClient
        .mockResolvedValueOnce(jsonResponse({
          challenge: fakeChallenge(),
          rp: { name: 'Soter' },
          user: { id: 'dGVzdA', name: 'n', displayName: 'N' },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        }))
        .mockResolvedValueOnce(jsonResponse({ verified: false, message: 'Invalid attestation' }));

      navigator.credentials = {
        create: jest.fn().mockResolvedValue(fakeCredentialResponse('create')),
        get: jest.fn(),
      } as unknown as typeof navigator.credentials;

      expect(await registerWebauthn()).toBe('failed');
    });

    it('returns "error" on non-DOM exceptions (e.g. network error fetching options)', async () => {
      setupEnrolledEnvironment();
      mockedFetchClient.mockRejectedValueOnce(new TypeError('Network request failed'));

      const result = await registerWebauthn();

      expect(result).toBe('error');
    });
  });

  describe('authentication flow (authenticateBiometric)', () => {
    function setupEnvironmentWithCredentialRegistered() {
      window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockResolvedValue(true),
      } as unknown as typeof window.PublicKeyCredential;
    }

    it('SUCCESS: performs just-in-time auto-registration then assertion, returns success', async () => {
      setupEnvironmentWithCredentialRegistered();

      mockedFetchClient
        // auth options → no credentials registered yet → triggers reg
        .mockResolvedValueOnce(jsonResponse({
          challenge: fakeChallenge(),
          rpId: 'localhost',
          allowCredentials: [],
          userVerification: 'required',
          timeout: 60000,
        }))
        // register options
        .mockResolvedValueOnce(jsonResponse({
          challenge: fakeChallenge(),
          rp: { name: 'Soter', id: 'localhost' },
          user: { id: 'dGVzdA', name: 'demo', displayName: 'Demo' },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        }))
        // register verify
        .mockResolvedValueOnce(jsonResponse({ verified: true, credentialId: 'test-credential-id' }))
        // auth options (second call after reg)
        .mockResolvedValueOnce(jsonResponse({
          challenge: fakeChallenge(),
          rpId: 'localhost',
          allowCredentials: [{ id: 'test-credential-id', type: 'public-key' }],
          userVerification: 'required',
        }))
        // auth verify
        .mockResolvedValueOnce(jsonResponse({ verified: true, credentialId: 'test-credential-id', counter: 1 }));

      navigator.credentials = {
        create: jest.fn().mockResolvedValue(fakeCredentialResponse('create')),
        get: jest.fn().mockResolvedValue(fakeCredentialResponse('get')),
      } as unknown as typeof navigator.credentials;

      const result = await authenticateBiometric({ userId: 'u1', requireRegistrationFallback: true });

      expect(result).toBe('success');
      expect(mockedFetchClient).toHaveBeenCalledTimes(5);
      expect(navigator.credentials.create).toHaveBeenCalledTimes(1);
      expect(navigator.credentials.get).toHaveBeenCalledTimes(1);
    });

    it('SUCCESS: when credentials already registered, goes straight to assertion', async () => {
      setupEnvironmentWithCredentialRegistered();

      mockedFetchClient
        .mockResolvedValueOnce(jsonResponse({
          challenge: fakeChallenge(),
          rpId: 'localhost',
          allowCredentials: [{ id: 'abc', type: 'public-key' }],
          userVerification: 'required',
        }))
        .mockResolvedValueOnce(jsonResponse({ verified: true, credentialId: 'abc', counter: 5 }));

      navigator.credentials = {
        create: jest.fn(),
        get: jest.fn().mockResolvedValue(fakeCredentialResponse('get')),
      } as unknown as typeof navigator.credentials;

      const result = await authenticateBiometric({ requireRegistrationFallback: false });

      expect(result).toBe('success');
      expect(mockedFetchClient).toHaveBeenCalledTimes(2);
      expect(navigator.credentials.create).not.toHaveBeenCalled();
      expect(navigator.credentials.get).toHaveBeenCalledTimes(1);
    });

    it('CANCELLATION: maps NotAllowedError during assertion to "cancelled"', async () => {
      setupEnvironmentWithCredentialRegistered();

      mockedFetchClient.mockResolvedValueOnce(jsonResponse({
        challenge: fakeChallenge(),
        rpId: 'localhost',
        allowCredentials: [{ id: 'x', type: 'public-key' }],
        userVerification: 'required',
      }));

      navigator.credentials = {
        create: jest.fn(),
        get: jest.fn().mockRejectedValue(new DOMException('Cancel', 'NotAllowedError')),
      } as unknown as typeof navigator.credentials;

      const result = await authenticateBiometric({ requireRegistrationFallback: false });

      expect(result).toBe('cancelled');
    });

    it('CANCELLATION: propagates registration-time cancellation through auto-registration', async () => {
      setupEnvironmentWithCredentialRegistered();

      mockedFetchClient
        // auth options: no creds yet
        .mockResolvedValueOnce(jsonResponse({
          challenge: fakeChallenge(),
          allowCredentials: [],
        }))
        // register options
        .mockResolvedValueOnce(jsonResponse({
          challenge: fakeChallenge(),
          rp: { name: 'Soter' },
          user: { id: 'dGVzdA', name: 'a', displayName: 'A' },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        }));

      navigator.credentials = {
        create: jest.fn().mockRejectedValue(new DOMException('Cancel', 'NotAllowedError')),
        get: jest.fn(),
      } as unknown as typeof navigator.credentials;

      const result = await authenticateBiometric({ requireRegistrationFallback: true });

      expect(result).toBe('cancelled');
    });

    it('FAILURE: server verification returns verified=false', async () => {
      setupEnvironmentWithCredentialRegistered();

      mockedFetchClient
        .mockResolvedValueOnce(jsonResponse({
          challenge: fakeChallenge(),
          allowCredentials: [{ id: 'x', type: 'public-key' }],
        }))
        .mockResolvedValueOnce(jsonResponse({ verified: false, message: 'Signature invalid' }));

      navigator.credentials = {
        create: jest.fn(),
        get: jest.fn().mockResolvedValue(fakeCredentialResponse('get')),
      } as unknown as typeof navigator.credentials;

      expect(await authenticateBiometric({ requireRegistrationFallback: false })).toBe('failed');
    });

    it('FAILURE: credential not registered, requireRegistrationFallback=false → fails', async () => {
      setupEnvironmentWithCredentialRegistered();
      mockedFetchClient.mockResolvedValueOnce(jsonResponse({
        challenge: fakeChallenge(),
        allowCredentials: [],
      }));

      // navigator.credentials.get with allowCredentials=[] → rejected with NotAllowedError
      // by browsers in real life. We simulate the same.
      navigator.credentials = {
        create: jest.fn(),
        get: jest.fn().mockRejectedValue(new DOMException('No credentials', 'NotAllowedError')),
      } as unknown as typeof navigator.credentials;

      const result = await authenticateBiometric({ requireRegistrationFallback: false });
      expect(result).toBe('cancelled');
    });
  });

  describe('promptBiometricAuthentication', () => {
    it('throws Error when availability is unavailable', async () => {
      window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockResolvedValue(false),
      } as unknown as typeof window.PublicKeyCredential;

      await expect(promptBiometricAuthentication()).rejects.toThrow('Biometric authentication not available');
    });

    it('returns result of authenticateBiometric when available', async () => {
      window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockResolvedValue(true),
      } as unknown as typeof window.PublicKeyCredential;

      mockedFetchClient
        .mockResolvedValueOnce(jsonResponse({
          challenge: fakeChallenge(),
          allowCredentials: [{ id: 'x', type: 'public-key' }],
        }))
        .mockResolvedValueOnce(jsonResponse({ verified: true, credentialId: 'x', counter: 1 }));

      navigator.credentials = {
        create: jest.fn(),
        get: jest.fn().mockResolvedValue(fakeCredentialResponse('get')),
      } as unknown as typeof navigator.credentials;

      const onProgress = jest.fn();
      const result = await promptBiometricAuthentication({ reason: 'Open sesame', userId: 'u2', onProgress });

      expect(result).toBe('success');
      expect(onProgress).toHaveBeenNthCalledWith(1, 'checking');
      expect(onProgress).toHaveBeenNthCalledWith(2, 'prompting');
      expect(onProgress).toHaveBeenNthCalledWith(3, 'verifying');
    });
  });

  describe('getBiometricStatus', () => {
    it('returns "available" when caps.isAvailable=true', async () => {
      window.PublicKeyCredential = {
        isUserVerifyingPlatformAuthenticatorAvailable: jest.fn().mockResolvedValue(true),
      } as unknown as typeof window.PublicKeyCredential;

      expect(await getBiometricStatus()).toBe('available');
    });

    it('returns "unknown" when checkBiometricAvailability throws', async () => {
      jest.doMock('../biometricService', () => {
        const actual = jest.requireActual('../biometricService');
        return {
          ...actual,
          checkBiometricAvailability: jest.fn().mockRejectedValue(new Error('boom')),
        };
      });
      jest.resetModules();
      const { getBiometricStatus: gbs } = require('../biometricService');
      expect(await gbs()).toBe('unknown');
    });
  });
});
