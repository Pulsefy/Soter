import {
  isSslPinningAvailable,
  initializeSslPinning,
  disableSslPinning,
  addSslPinningErrorListener,
  type PinningOptions,
} from 'react-native-ssl-public-key-pinning';
import { config, AppConfig } from '../config';
import { structuredLogger } from './logger';

/**
 * Error codes for certificate pinning failures.
 */
export enum CertificatePinningErrorCode {
  /** Presented key matched none of the configured pins, including backups. */
  NO_VALID_BACKUP_PIN = 'NO_VALID_BACKUP_PIN',
  /** Pin mismatch reported without a configured backup set to exhaust. */
  PIN_MISMATCH = 'PIN_MISMATCH',
}

const ERROR_MESSAGES: Record<CertificatePinningErrorCode, (hostname: string) => string> = {
  [CertificatePinningErrorCode.NO_VALID_BACKUP_PIN]: (hostname) =>
    `Secure connection to ${hostname} was refused because neither the current certificate pin nor a backup pin matched the server. This is a certificate rotation lockout, not a general network failure. Update the app to a build that includes the new pin before trying again.`,
  [CertificatePinningErrorCode.PIN_MISMATCH]: (hostname) =>
    `Secure connection to ${hostname} could not be verified: the server's certificate does not match Soter's pinned keys. This may indicate a network attack. Please try again on a trusted network.`,
};

/**
 * Thrown in place of a generic network error when a request failed because
 * the server's certificate did not match a pinned public key.
 *
 * `NO_VALID_BACKUP_PIN` is the rotation/expiry case: every shipped pin,
 * including backups, was rejected. `PIN_MISMATCH` is the attack-shaped
 * failure used when a backup set was not part of the decision.
 */
export class CertificatePinningError extends Error {
  public readonly code: CertificatePinningErrorCode;
  public readonly hostname: string;

  constructor(hostname: string, code: CertificatePinningErrorCode = CertificatePinningErrorCode.PIN_MISMATCH) {
    super(ERROR_MESSAGES[code](hostname));
    this.name = 'CertificatePinningError';
    this.code = code;
    this.hostname = hostname;
    Object.setPrototypeOf(this, CertificatePinningError.prototype);
  }
}

/** First configured hash is the live certificate; the rest are backups. */
export type PinEvaluation =
  | { outcome: 'primary' }
  | { outcome: 'backup'; backupIndex: number }
  | { outcome: 'no_valid_pin' };

/**
 * Compare a presented SPKI hash to the configured pin set.
 * A match on any backup pin is success: one rotation must not lock users out.
 * A match on none of the pins is `no_valid_pin`.
 */
export const evaluatePresentedPin = (presentedHash: string, hashes: readonly string[]): PinEvaluation => {
  if (hashes.length > 0 && hashes[0] === presentedHash) {
    return { outcome: 'primary' };
  }

  const backupIndex = hashes.slice(1).findIndex((hash) => hash === presentedHash);
  if (backupIndex >= 0) {
    return { outcome: 'backup', backupIndex };
  }

  return { outcome: 'no_valid_pin' };
};

/**
 * Accept a presented certificate when the primary pin or a backup pin matches.
 * Throws `CertificatePinningError` with `NO_VALID_BACKUP_PIN` when nothing matches.
 */
export const acceptPresentedPin = (
  hostname: string,
  presentedHash: string,
  hashes: readonly string[],
): PinEvaluation => {
  const evaluation = evaluatePresentedPin(presentedHash, hashes);

  if (evaluation.outcome === 'backup') {
    structuredLogger.warn(
      'certificate_pinning.backup_pin_accepted',
      { hostname, backupIndex: evaluation.backupIndex },
      'certificatePinning',
    );
  }

  if (evaluation.outcome === 'no_valid_pin') {
    throw new CertificatePinningError(hostname, CertificatePinningErrorCode.NO_VALID_BACKUP_PIN);
  }

  return evaluation;
};

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '10.0.2.2', '::1']);

/**
 * How long a reported pin mismatch stays attributable to a subsequent
 * failing fetch call to the same host. The native pinning layer fails the
 * TLS handshake itself rather than surfacing a typed JS error, so we
 * correlate the out-of-band error event with the fetch rejection by time.
 */
const PIN_ERROR_ATTRIBUTION_WINDOW_MS = 5000;

const recentPinErrorsByHostname = new Map<string, number>();

/** Pin set from the last successful initialization, keyed by hostname. */
const activePinsByHostname = new Map<string, readonly string[]>();

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
    structuredLogger.warn(
      'certificate_pinning.skipped',
      {
        hostname,
        hashCount: appConfig.certPinHashes.length,
      },
      'certificatePinning',
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
    structuredLogger.warn(
      'certificate_pinning.unavailable',
      { apiUrl: appConfig.apiUrl },
      'certificatePinning',
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
    activePinsByHostname.set(hostname, appConfig.certPinHashes);
  } catch (error) {
    structuredLogger.error(
      'certificate_pinning.initialize_failed',
      { hostname, error: error instanceof Error ? error.message : String(error) },
      'certificatePinning',
    );
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
      const pins = activePinsByHostname.get(hostname) ?? [];
      // Native pinning already accepts any configured hash. An error event
      // means the primary pin and every backup pin were rejected.
      const code =
        pins.length >= 2
          ? CertificatePinningErrorCode.NO_VALID_BACKUP_PIN
          : CertificatePinningErrorCode.PIN_MISMATCH;
      throw new CertificatePinningError(hostname, code);
    }
  }

  throw error;
};
