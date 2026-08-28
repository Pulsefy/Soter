import {
  isSslPinningAvailable,
  initializeSslPinning,
  disableSslPinning,
  addSslPinningErrorListener,
  type PinningOptions,
} from 'react-native-ssl-public-key-pinning';
import { config, AppConfig } from '../config';

/**
 * Error codes for certificate pinning failures.
 */
export enum CertificatePinningErrorCode {
  PIN_MISMATCH = 'PIN_MISMATCH',
}

/**
 * Thrown in place of a generic network error when a request failed because
 * the server's certificate did not match one of our pinned public keys.
 */
export class CertificatePinningError extends Error {
  public readonly code: CertificatePinningErrorCode;
  public readonly hostname: string;

  constructor(hostname: string) {
    super(
      `Secure connection to ${hostname} could not be verified: the server's certificate does not match Soter's pinned keys. This may indicate a network attack. Please try again on a trusted network.`,
    );
    this.name = 'CertificatePinningError';
    this.code = CertificatePinningErrorCode.PIN_MISMATCH;
    this.hostname = hostname;
    Object.setPrototypeOf(this, CertificatePinningError.prototype);
  }
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '10.0.2.2', '::1']);

/**
 * How long a reported pin mismatch stays attributable to a subsequent
 * failing fetch call to the same host. The native pinning layer fails the
 * TLS handshake itself rather than surfacing a typed JS error, so we
 * correlate the out-of-band error event with the fetch rejection by time.
 */
const PIN_ERROR_ATTRIBUTION_WINDOW_MS = 5000;

const recentPinErrorsByHostname = new Map<string, number>();

/**
 * Extract the hostname from a URL, returning null if the URL is malformed.
 */
export const getHostnameFromUrl = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/**
 * True for loopback/emulator addresses used to reach a locally-running
 * backend during development, where certificate pinning must stay disabled.
 */
export const isLocalBackendHostname = (hostname: string | null): boolean => {
  if (!hostname) return false;
  return LOOPBACK_HOSTNAMES.has(hostname);
};

const buildPinningOptions = (appConfig: AppConfig, hostname: string): PinningOptions | null => {
  if (appConfig.certPinHashes.length < 2) {
    console.warn(
      `[certificatePinning] Skipping certificate pinning for ${hostname}: at least 2 public key hashes ` +
        `(primary + backup) are required via EXPO_PUBLIC_CERT_PIN_HASHES, got ${appConfig.certPinHashes.length}.`,
    );
    return null;
  }

  return {
    [hostname]: {
      includeSubdomains: appConfig.certPinIncludeSubdomains,
      publicKeyHashes: appConfig.certPinHashes,
    },
  };
};

/**
 * Initializes SSL public key pinning for the backend API host. Must be
 * called as early as possible in the app entry point, before any network
 * requests fire.
 *
 * No-ops when: the native pinning module isn't available (Expo Go, or a
 * dev client built before this dependency was added), the API host is a
 * local/emulator backend, or no pin hashes are configured for this build.
 */
export const initializeCertificatePinning = async (appConfig: AppConfig = config): Promise<void> => {
  if (!isSslPinningAvailable()) {
    console.warn(
      '[certificatePinning] Native SSL pinning module unavailable (Expo Go or a build predating this dependency); requests are unpinned.',
    );
    return;
  }

  const hostname = getHostnameFromUrl(appConfig.apiUrl);

  if (isLocalBackendHostname(hostname)) {
    await disableSslPinning().catch(() => undefined);
    return;
  }

  if (!hostname) {
    return;
  }

  const options = buildPinningOptions(appConfig, hostname);
  if (!options) {
    return;
  }

  addSslPinningErrorListener((error) => {
    recentPinErrorsByHostname.set(error.serverHostname, Date.now());
  });

  try {
    await initializeSslPinning(options);
  } catch (error) {
    console.error('[certificatePinning] Failed to initialize SSL pinning:', error);
  }
};

/**
 * Re-throws a caught fetch error, upgrading it to a `CertificatePinningError`
 * when it correlates with a recent pin-mismatch event for the request's
 * host. Call this from a `catch` block in place of `throw error`.
 */
export const guardAgainstPinningFailure = (url: string, error: unknown): never => {
  const hostname = getHostnameFromUrl(url);

  if (hostname) {
    const reportedAt = recentPinErrorsByHostname.get(hostname);
    if (reportedAt != null && Date.now() - reportedAt <= PIN_ERROR_ATTRIBUTION_WINDOW_MS) {
      recentPinErrorsByHostname.delete(hostname);
      throw new CertificatePinningError(hostname);
    }
  }

  throw error;
};
