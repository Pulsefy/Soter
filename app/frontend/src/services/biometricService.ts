/**
 * WebAuthn-based biometric authentication service.
 *
 * Replaces the previous mock implementation with real browser WebAuthn API calls
 * (navigator.credentials.create / navigator.credentials.get) backed by server-side
 * challenge verification via @simplewebauthn.
 *
 * Flow overview:
 *   1. checkBiometricAvailability()  → detects platform authenticator support
 *   2. registerPasskey(email)        → one-time credential registration
 *   3. authenticateBiometric(email)  → verify identity with registered passkey
 *   4. promptBiometricAuthentication() → high-level wrapper used by useBiometricGate
 *
 * The exported types (BiometricStatus, BiometricAuthResult, BiometricCapabilities)
 * are preserved for backward compatibility with existing consumers.
 */

// ---------------------------------------------------------------------------
// Types (preserved from the mock implementation)
// ---------------------------------------------------------------------------

export type BiometricStatus = 'available' | 'unavailable' | 'unknown';

export type BiometricAuthResult = 'success' | 'failed' | 'cancelled' | 'error';

export interface BiometricCapabilities {
  /** Whether biometric (WebAuthn platform authenticator) is available */
  isAvailable: boolean;
  /** Type of biometric support */
  type: 'face_id' | 'touch_id' | 'webauthn' | 'none';
  /** Description for debugging */
  description: string;
  /** Whether the user has at least one registered passkey */
  hasRegisteredCredential: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const WEBAUTHN_BASE = `${API_URL}/api/v1/webauthn`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a base64url string to a Uint8Array (browser WebAuthn API expects buffers).
 */
function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

/**
 * Convert a Uint8Array to a base64url string (server expects base64url).
 */
function bufferToBase64url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Detect whether the browser supports WebAuthn with a platform authenticator.
 */
function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

/**
 * Check if the browser can use a platform authenticator (Touch ID, Face ID, Windows Hello).
 */
async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Checks if biometric (WebAuthn platform authenticator) authentication is available.
 */
export async function checkBiometricAvailability(): Promise<BiometricCapabilities> {
  const supported = isWebAuthnSupported();
  const platformAvailable = await isPlatformAuthenticatorAvailable();

  if (!supported || !platformAvailable) {
    return {
      isAvailable: false,
      type: 'none',
      description: 'WebAuthn platform authenticator not available on this device/browser',
      hasRegisteredCredential: false,
    };
  }

  return {
    isAvailable: true,
    type: 'webauthn',
    description: 'WebAuthn platform authenticator available (Touch ID / Face ID / Windows Hello)',
    hasRegisteredCredential: false, // Will be enriched by callers that check credentials
  };
}

/**
 * Register a new passkey (WebAuthn credential) for a user.
 *
 * This calls the server for registration options, invokes
 * navigator.credentials.create(), then sends the attestation back for verification.
 */
export async function registerPasskey(
  email: string,
  label?: string,
): Promise<{ success: boolean; credentialId: string; message: string }> {
  // 1. Get registration options from server
  const optionsRes = await fetch(
    `${WEBAUTHN_BASE}/register/options?email=${encodeURIComponent(email)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    },
  );

  if (!optionsRes.ok) {
    const err = await optionsRes.json().catch(() => ({ message: 'Failed to get registration options' }));
    throw new Error(err.message ?? 'Failed to get registration options');
  }

  const options = await optionsRes.json();

  // 2. Build PublicKeyCredentialCreationOptions for the browser API
  const createOptions: PublicKeyCredentialCreationOptions = {
    challenge: base64urlToBuffer(options.challenge),
    rp: {
      id: options.rpId,
      name: options.rpName,
    },
    user: {
      id: base64urlToBuffer(options.userId),
      name: options.userName,
      displayName: options.userDisplayName,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    timeout: options.timeout,
    attestation: options.attestation ?? 'none',
  };

  // 3. Create the credential via the browser API
  let credential: PublicKeyCredential;
  try {
    const result = (await navigator.credentials.create({
      publicKey: createOptions,
    })) as PublicKeyCredential | null;

    if (!result) {
      throw new Error('Credential creation returned null');
    }
    credential = result;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return { success: false, credentialId: '', message: 'Registration cancelled by user' };
    }
    throw err;
  }

  const attestationResponse = (credential.response as AuthenticatorAttestationResponse);

  // 4. Send the attestation to the server for verification
  const verifyRes = await fetch(`${WEBAUTHN_BASE}/register/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId: options.challengeId,
      credentialId: bufferToBase64url(credential.rawId),
      attestationObject: bufferToBase64url(attestationResponse.attestationObject),
      clientDataJSON: bufferToBase64url(attestationResponse.clientDataJSON),
      authenticatorAttachment: credential.authenticatorAttachment ?? 'platform',
      label,
    }),
  });

  if (!verifyRes.ok) {
    const err = await verifyRes.json().catch(() => ({ message: 'Registration verification failed' }));
    throw new Error(err.message ?? 'Registration verification failed');
  }

  return verifyRes.json();
}

/**
 * Authenticate using a registered WebAuthn passkey.
 *
 * Calls the server for authentication options, invokes navigator.credentials.get(),
 * then sends the assertion for verification.
 */
export async function authenticateBiometric(options?: {
  reason?: string;
  timeout?: number;
  email?: string;
}): Promise<BiometricAuthResult> {
  const { email } = options ?? {};

  // 1. Get authentication options from server
  const optionsRes = await fetch(`${WEBAUTHN_BASE}/auth/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  if (!optionsRes.ok) {
    const err = await optionsRes.json().catch(() => ({ message: 'Failed to get authentication options' }));
    console.error('[WebAuthn] Options error:', err);
    return 'error';
  }

  const authOptions = await optionsRes.json();

  // 2. Build PublicKeyCredentialRequestOptions for the browser API
  const getOptions: PublicKeyCredentialRequestOptions = {
    challenge: base64urlToBuffer(authOptions.challenge),
    rpId: authOptions.rpId,
    timeout: authOptions.timeout,
    userVerification: authOptions.userVerification ?? 'preferred',
    allowCredentials: (authOptions.allowCredentials ?? []).map(
      (cred: { id: string; type: string; transports: string[] }) => ({
        id: base64urlToBuffer(cred.id),
        type: 'public-key' as const,
        transports: cred.transports as AuthenticatorTransport[],
      }),
    ),
  };

  // 3. Get the assertion from the browser
  let credential: PublicKeyCredential;
  try {
    const result = (await navigator.credentials.get({
      publicKey: getOptions,
    })) as PublicKeyCredential | null;

    if (!result) {
      return 'cancelled';
    }
    credential = result;
  } catch (err: unknown) {
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError') return 'cancelled';
      if (err.name === 'SecurityError') return 'failed';
    }
    console.error('[WebAuthn] Authentication error:', err);
    return 'error';
  }

  const assertionResponse = credential.response as AuthenticatorAssertionResponse;

  // 4. Send the assertion to the server for verification
  const verifyRes = await fetch(`${WEBAUTHN_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId: authOptions.challengeId,
      credentialId: bufferToBase64url(credential.rawId),
      authenticatorData: bufferToBase64url(assertionResponse.authenticatorData),
      clientDataJSON: bufferToBase64url(assertionResponse.clientDataJSON),
      signature: bufferToBase64url(assertionResponse.signature),
      userHandle: assertionResponse.userHandle
        ? bufferToBase64url(assertionResponse.userHandle)
        : undefined,
    }),
  });

  if (!verifyRes.ok) {
    if (verifyRes.status === 401) return 'failed';
    console.error('[WebAuthn] Verification failed:', await verifyRes.text());
    return 'error';
  }

  const result = await verifyRes.json();
  return result.success ? 'success' : 'failed';
}

/**
 * Returns a simple biometric availability status.
 */
export async function getBiometricStatus(): Promise<BiometricStatus> {
  try {
    const capabilities = await checkBiometricAvailability();
    return capabilities.isAvailable ? 'available' : 'unavailable';
  } catch (error) {
    console.error('[WebAuthn] Error checking biometric status:', error);
    return 'unknown';
  }
}

/**
 * List registered passkeys for a user.
 */
export async function listRegisteredPasskeys(email: string) {
  const res = await fetch(
    `${WEBAUTHN_BASE}/credentials?email=${encodeURIComponent(email)}`,
  );
  if (!res.ok) {
    throw new Error('Failed to list credentials');
  }
  return res.json() as Promise<
    Array<{
      id: string;
      credentialId: string;
      attachment: string;
      label: string | null;
      verified: boolean;
      createdAt: string;
      lastUsedAt: string | null;
    }>
  >;
}

/**
 * Delete a registered passkey.
 */
export async function deletePasskey(credentialId: string, userId: string) {
  const res = await fetch(
    `${WEBAUTHN_BASE}/credentials/${encodeURIComponent(credentialId)}?userId=${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw new Error('Failed to delete credential');
  }
  return res.json() as Promise<{ success: boolean; message: string }>;
}

/**
 * High-level wrapper used by useBiometricGate hook.
 * Checks availability, then performs authentication.
 */
export async function promptBiometricAuthentication(
  options?: {
    reason?: string;
    email?: string;
    onProgress?: (step: 'checking' | 'prompting' | 'verifying') => void;
  },
): Promise<BiometricAuthResult> {
  const { reason = 'Confirm your identity', email, onProgress } = options ?? {};

  // Step 1: Check availability
  onProgress?.('checking');
  const capabilities = await checkBiometricAvailability();

  if (!capabilities.isAvailable) {
    console.log('[WebAuthn] Platform authenticator not available');
    throw new Error('Biometric authentication not available');
  }

  // Step 2: Show prompt (the browser handles this natively)
  onProgress?.('prompting');

  // Step 3: Authenticate
  onProgress?.('verifying');
  const result = await authenticateBiometric({ reason, email });

  return result;
}
