/**
 * WebAuthn-based biometric authentication service.
 *
 * Uses the browser's Web Authentication API (WebAuthn) to trigger real
 * platform authenticator prompts — Face ID, Touch ID, Windows Hello,
 * Android BiometricPrompt, or device-level PIN/pattern.
 *
 * Flow:
 *   Availability check:
 *     window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable()
 *
 *   Registration (once per device/user):
 *     GET  /auth/webauthn/register/options   → challenge + user/rp info
 *     navigator.credentials.create(...)      → triggers OS biometric prompt
 *     POST /auth/webauthn/register/verify    → server validates attestation
 *
 *   Authentication (on each high-risk action):
 *     GET  /auth/webauthn/auth/options       → challenge + allowCredentials
 *     navigator.credentials.get(...)         → triggers OS biometric prompt
 *     POST /auth/webauthn/auth/verify        → server validates assertion
 *
 * Unsupported browsers fall back cleanly through useBiometricGate,
 * which shows <BiometricConfirmationModal/> instead of biometric prompt.
 */

import { fetchClient } from '@/lib/mock-api/client';

export type BiometricStatus =
  | 'available'
  | 'unavailable'
  | 'unknown';

export type BiometricAuthResult =
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'error';

export interface BiometricCapabilities {
  /** Whether biometric / platform authentication is available on this device */
  isAvailable: boolean;
  /** Type of authenticator support detected */
  type: 'face_id' | 'touch_id' | 'webauthn' | 'windows_hello' | 'none';
  /** Human-readable description for debugging / UI banners */
  description: string;
  /** Whether the browser supports the WebAuthn API at all */
  webauthnSupported: boolean;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  const base64 = padded + '='.repeat(pad);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

interface RegisterOptionsResponse {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ alg: number; type: 'public-key' }>;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: Array<{ id: string; type: 'public-key'; transports?: AuthenticatorTransport[] }>;
}

interface AuthOptionsResponse {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: Array<{ id: string; type: 'public-key'; transports?: AuthenticatorTransport[] }>;
  userVerification?: UserVerificationRequirement;
  extensions?: AuthenticationExtensionsClientInputs;
}

interface VerifyResponse {
  verified: boolean;
  message?: string;
  credentialId?: string;
  counter?: number;
}

function mapWebauthnErrorToResult(err: unknown): BiometricAuthResult {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
        return 'cancelled';
      case 'AbortError':
        return 'cancelled';
      case 'SecurityError':
      case 'NotSupportedError':
      case 'InvalidStateError':
        return 'failed';
      case 'NotReadableError':
      case 'UnknownError':
      default:
        return 'error';
    }
  }
  return 'error';
}

function inferAuthenticatorType(capabilities: string[]): BiometricCapabilities['type'] {
  if (capabilities.includes('face')) return 'face_id';
  if (capabilities.includes('fingerprint')) return 'touch_id';
  if (capabilities.includes('windows-hello')) return 'windows_hello';
  return 'webauthn';
}

/**
 * Checks if WebAuthn + platform biometric / user-verifying authenticator
 * is available on the current device.
 */
export async function checkBiometricAvailability(): Promise<BiometricCapabilities> {
  if (!isBrowser()) {
    return {
      isAvailable: false,
      type: 'none',
      description: 'Biometric authentication only available in browser environments',
      webauthnSupported: false,
    };
  }

  const hasPublicKeyCredential = typeof window.PublicKeyCredential !== 'undefined';
  const hasIsUVPAA = typeof window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable === 'function';

  if (!hasPublicKeyCredential || !hasIsUVPAA) {
    return {
      isAvailable: false,
      type: 'none',
      description: 'This browser does not support WebAuthn biometric authentication',
      webauthnSupported: false,
    };
  }

  try {
    const uvpaa = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    const detectedCapabilities: string[] = [];

    if (typeof (window.PublicKeyCredential as unknown as Record<string, unknown>).isExternalCTAP2SecurityKeySupported === 'function') {
      // reserved for future cross-platform key support detection
    }

    // Heuristics: infer platform biometric type from UA strings
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|mac os x/.test(ua)) detectedCapabilities.push('face');
    if (/android/.test(ua)) detectedCapabilities.push('fingerprint');
    if (/windows/.test(ua)) detectedCapabilities.push('windows-hello');

    if (!uvpaa) {
      return {
        isAvailable: false,
        type: 'none',
        description: 'This device does not have a user-verifying platform authenticator enrolled (e.g. no biometrics / PIN configured)',
        webauthnSupported: true,
      };
    }

    const type = inferAuthenticatorType(detectedCapabilities);
    return {
      isAvailable: true,
      type,
      description: `WebAuthn platform authenticator available via ${type}`,
      webauthnSupported: true,
    };
  } catch (err) {
    console.error('[biometricService] checkBiometricAvailability error:', err);
    return {
      isAvailable: false,
      type: 'none',
      description: 'Unexpected error while checking biometric support',
      webauthnSupported: hasPublicKeyCredential,
    };
  }
}

export async function getBiometricStatus(): Promise<BiometricStatus> {
  try {
    const caps = await checkBiometricAvailability();
    return caps.isAvailable ? 'available' : 'unavailable';
  } catch (err) {
    console.error('[biometricService] getBiometricStatus error:', err);
    return 'unknown';
  }
}

export interface WebauthnRegisterOptions {
  username?: string;
  displayName?: string;
  userId?: string;
}

export async function registerWebauthn(opts?: WebauthnRegisterOptions): Promise<BiometricAuthResult> {
  if (!isBrowser() || typeof window.PublicKeyCredential === 'undefined') {
    return 'error';
  }

  const qs = new URLSearchParams();
  if (opts?.username) qs.set('username', opts.username);
  if (opts?.displayName) qs.set('displayName', opts.displayName);
  if (opts?.userId) qs.set('userId', opts.userId);

  try {
    const optionsRes = await fetchClient(`/auth/webauthn/register/options?${qs.toString()}`, { method: 'GET' });
    if (!optionsRes.ok) return 'error';
    const options: RegisterOptionsResponse = await optionsRes.json();

    const publicKey: PublicKeyCredentialCreationOptions = {
      challenge: base64UrlToArrayBuffer(options.challenge),
      rp: options.rp,
      user: {
        id: base64UrlToArrayBuffer(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      attestation: options.attestation,
      authenticatorSelection: options.authenticatorSelection,
      excludeCredentials: (options.excludeCredentials ?? []).map((ec) => ({
        id: base64UrlToArrayBuffer(ec.id),
        type: ec.type,
        transports: ec.transports,
      })),
    };

    const credential = await navigator.credentials.create({ publicKey });
    if (!credential || !(credential instanceof PublicKeyCredential)) {
      return 'failed';
    }

    const response = credential.response as AuthenticatorAttestationResponse;
    const clientDataJSON = arrayBufferToBase64Url(response.clientDataJSON);
    const attestationObject = arrayBufferToBase64Url(response.attestationObject);
    const rawId = arrayBufferToBase64Url(credential.rawId);

    const verifyRes = await fetchClient('/auth/webauthn/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: credential.id,
        rawId,
        type: credential.type,
        response: {
          clientDataJSON,
          attestationObject,
        },
      }),
    });

    if (!verifyRes.ok) return 'failed';
    const verify: VerifyResponse = await verifyRes.json();
    return verify.verified ? 'success' : 'failed';
  } catch (err) {
    console.error('[biometricService] registerWebauthn error:', err);
    return mapWebauthnErrorToResult(err);
  }
}

export interface AuthenticateOptions {
  reason?: string;
  timeout?: number;
  userId?: string;
  requireRegistrationFallback?: boolean;
}

/**
 * Performs WebAuthn authentication: fetches assertion options from the
 * server, calls navigator.credentials.get() which triggers the native OS
 * biometric / platform prompt, then sends the assertion back for server
 * verification.
 *
 * If no credentials are registered yet AND requireRegistrationFallback is
 * true, this function will attempt a self-registration first so that a
 * subsequent auth call can succeed. This is suitable for "press here to
 * confirm" flows that don't require pre-enrollment on the backend.
 */
export async function authenticateBiometric(opts?: AuthenticateOptions): Promise<BiometricAuthResult> {
  if (!isBrowser() || typeof window.PublicKeyCredential === 'undefined') {
    return 'error';
  }

  const { timeout = 60000, userId, requireRegistrationFallback = true } = opts ?? {};

  try {
    const qs = new URLSearchParams();
    if (userId) qs.set('userId', userId);

    const optionsRes = await fetchClient(`/auth/webauthn/auth/options?${qs.toString()}`, { method: 'GET' });
    if (!optionsRes.ok) return 'error';
    const options: AuthOptionsResponse = await optionsRes.json();

    // If no credentials are pre-registered on the mock backend, attempt a
    // just-in-time registration so the authenticator has something to assert.
    // This matches the previous "mock any outcome" UX while using real APIs.
    const hasCredentials = (options.allowCredentials ?? []).length > 0;
    if (!hasCredentials && requireRegistrationFallback) {
      const regResult = await registerWebauthn({ userId });
      if (regResult !== 'success') return regResult;
      return authenticateBiometric({ ...opts, requireRegistrationFallback: false });
    }

    const publicKey: PublicKeyCredentialRequestOptions = {
      challenge: base64UrlToArrayBuffer(options.challenge),
      timeout: Math.max(timeout, options.timeout ?? 0),
      rpId: options.rpId,
      allowCredentials: (options.allowCredentials ?? []).map((ac) => ({
        id: base64UrlToArrayBuffer(ac.id),
        type: ac.type,
        transports: ac.transports,
      })),
      userVerification: options.userVerification ?? 'required',
      extensions: options.extensions,
    };

    const assertion = await navigator.credentials.get({ publicKey });
    if (!assertion || !(assertion instanceof PublicKeyCredential)) {
      return 'failed';
    }

    const response = assertion.response as AuthenticatorAssertionResponse;
    const rawId = arrayBufferToBase64Url(assertion.rawId);

    const verifyRes = await fetchClient('/auth/webauthn/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: assertion.id,
        rawId,
        type: assertion.type,
        response: {
          clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
          authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
          signature: arrayBufferToBase64Url(response.signature),
          userHandle: response.userHandle ? arrayBufferToBase64Url(response.userHandle) : undefined,
        },
      }),
    });

    if (!verifyRes.ok) return 'failed';
    const verify: VerifyResponse = await verifyRes.json();
    return verify.verified ? 'success' : 'failed';
  } catch (err) {
    console.error('[biometricService] authenticateBiometric error:', err);
    return mapWebauthnErrorToResult(err);
  }
}

export async function promptBiometricAuthentication(
  opts?: {
    reason?: string;
    userId?: string;
    onProgress?: (step: 'checking' | 'prompting' | 'verifying') => void;
  }
): Promise<BiometricAuthResult> {
  const { reason = 'Confirm your identity', userId, onProgress } = opts ?? {};

  onProgress?.('checking');
  const caps = await checkBiometricAvailability();
  if (!caps.isAvailable) {
    throw new Error('Biometric authentication not available');
  }

  onProgress?.('prompting');
  console.log(`[biometricService] Platform authenticator prompt: ${reason}`);

  onProgress?.('verifying');
  return authenticateBiometric({ reason, userId });
}
