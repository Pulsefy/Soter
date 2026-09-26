import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import * as expoConstants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CRASH_REPORTING_ENABLED_KEY = '@soter/crash_reporting_enabled';

/**
 * Patterns for PII and sensitive data that must never leave the device.
 * Applied as beforeSend scrubber on every outgoing event.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // Wallet / crypto keys
  /secret[_-]?key/i,
  /private[_-]?key/i,
  /mnemonic/i,
  /seed[_-]?phrase/i,
  /stellar[_-]?secret/i,
  // Stellar public keys (G...) – scrub from stack traces and breadcrumbs
  /G[A-Z2-7]{55}/,
  // Stellar addresses in URIs
  /stellar:\/\/[^\s]*/i,
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  // Phone numbers (international format)
  /\+\d{1,3}[\s-]?\d{4,14}/,
  // IP addresses
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  // JWT tokens
  /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/,
  // Base64-encoded evidence / image data
  /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/,
  // WalletConnect pairing URIs
  /wc:[a-zA-Z0-9_-]+@/i,
];

/**
 * Keys that should be stripped from event extra/context data.
 */
const SCRUBBED_EXTRA_KEYS = new Set([
  'publicKey',
  'secretKey',
  'privateKey',
  'seedPhrase',
  'mnemonic',
  'email',
  'phone',
  'walletAddress',
  'stellarAddress',
  'evidence',
  'evidenceUrl',
  'imageUrl',
  'base64Data',
  'jwt',
  'token',
  'accessToken',
  'refreshToken',
  'password',
  'passphrase',
]);

function scrubString(value: string): string {
  let scrubbed = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  return scrubbed;
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SCRUBBED_EXTRA_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      result[key] = scrubString(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = scrubObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string'
          ? scrubString(item)
          : item && typeof item === 'object'
            ? scrubObject(item as Record<string, unknown>)
            : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function scrubEvent(event: Sentry.Event): Sentry.Event {
  // Scrub exception values and stack frames
  if (event.exception?.values) {
    for (const exc of event.exception.values) {
      if (exc.value) exc.value = scrubString(exc.value);
      if (exc.stacktrace?.frames) {
        for (const frame of exc.stacktrace.frames) {
          if (frame.filename) frame.filename = scrubString(frame.filename);
          if (frame.function) frame.function = scrubString(frame.function);
          if (frame.vars && typeof frame.vars === 'object') {
            frame.vars = scrubObject(frame.vars as Record<string, unknown>);
          }
        }
      }
    }
  }

  // Scrub breadcrumbs
  if (event.breadcrumbs?.values) {
    for (const crumb of event.breadcrumbs.values) {
      if (typeof crumb.data === 'object' && crumb.data !== null) {
        crumb.data = scrubObject(crumb.data as Record<string, unknown>);
      }
      if (typeof crumb.message === 'string') {
        crumb.message = scrubString(crumb.message);
      }
    }
  }

  // Scrub extra context
  if (event.extra && typeof event.extra === 'object') {
    event.extra = scrubObject(event.extra);
  }

  // Scrub tags (only keep safe ones)
  if (event.tags && typeof event.tags === 'object') {
    event.tags = scrubObject(event.tags as Record<string, unknown>);
  }

  // Scrub request data (URLs, headers)
  if (event.request?.url) {
    event.request.url = scrubString(event.request.url);
  }
  if (event.request?.headers && typeof event.request.headers === 'object') {
    event.request.headers = scrubObject(
      event.request.headers as Record<string, unknown>,
    );
  }

  return event;
}

/**
 * Read the app version and build number from expo-constants at runtime.
 */
function getReleaseInfo(): { release: string; dist: string } {
  const manifest = expoConstants.expoConfig?.version ?? '1.0.0';
  const androidVersionCode =
    expoConstants.expoConfig?.android?.versionCode ?? '1';
  const iosBuildNumber =
    expoConstants.expoConfig?.ios?.buildNumber ?? '1';

  const dist =
    Platform.OS === 'android'
      ? String(androidVersionCode)
      : String(iosBuildNumber);

  return {
    release: `${expoConstants.expoConfig?.slug ?? 'mobile'}@${manifest}`,
    dist,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let initialized = false;

/**
 * Initialise Sentry crash reporting. Safe to call multiple times – only the
 * first call has any effect.
 *
 * When `enabled` is false, all Sentry SDK processing is disabled (events are
 * silently dropped) without removing the SDK wrappers from the component tree.
 */
export function initCrashReporting(enabled: boolean): void {
  if (initialized) return;

  const { release, dist } = getReleaseInfo();
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

  Sentry.init({
    dsn: dsn || undefined,
    enabled: enabled && !!dsn,
    enableAutoSessionTracking: true,
    sessionTrackingIntervalMillis: 30_000,
    // Attach release & build to every report
    release,
    dist,
    // Outbound network request → scrub URL / headers
    sendDefaultPii: false,
    // Offline support: queue events locally and flush on next connect
    maxQueueSize: 100,
    // Attach stack traces to messages
    attachStacktrace: true,
    // Sample rate for performance (keep low for field devices)
    tracesSampleRate: 0.1,
    // Deduplication
    enableAutoBreadcrumbs: true,
    // beforeSend – scrub PII and evidence before any data leaves the device
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => {
      if (event.transaction) {
        event.transaction = scrubString(event.transaction);
      }
      return event;
    },
    // Ignore common non-actionable errors
    ignoreErrors: [
      'Network request failed',
      'abort',
      'Camera not ready',
      'User cancelled',
      'AppState',
    ],
  });

  initialized = true;
}

/**
 * Toggle crash reporting on or off at runtime.
 * Persists the preference to AsyncStorage and flushes / disables the SDK.
 */
export async function setCrashReportingEnabled(
  enabled: boolean,
): Promise<void> {
  await AsyncStorage.setItem(
    CRASH_REPORTING_ENABLED_KEY,
    JSON.stringify(enabled),
  );

  if (enabled) {
    Sentry.enableSessionTracking();
  } else {
    Sentry.close();
    // Re-initialise in disabled state so wrapper components don't crash
    initialized = false;
    initCrashReporting(false);
  }
}

/**
 * Read the persisted crash reporting preference.
 * Returns `true` (enabled) when no preference has been stored yet – this is
 * the privacy-respecting default that still gives the team visibility.
 */
export async function isCrashReportingEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(CRASH_REPORTING_ENABLED_KEY);
    if (raw === null) return true; // default: enabled
    return JSON.parse(raw) as boolean;
  } catch {
    return true;
  }
}

/**
 * Capture a non-fatal JS error (e.g. from a try/catch).
 */
export function captureError(error: Error, context?: Record<string, unknown>): void {
  if (context) {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra(key, value);
      }
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/**
 * Capture a breadcrumb for navigation / user actions.
 */
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level: 'info',
  });
}

/**
 * Set user context (does NOT include PII – only a device-scoped id).
 */
export function setCrashContext(context: Record<string, string>): void {
  Sentry.setExtras(context);
}

/**
 * Flush any queued events (call before app backgrounding).
 */
export async function flushCrashReports(timeout = 2000): Promise<void> {
  await Sentry.flush(timeout);
}

export { Sentry };
