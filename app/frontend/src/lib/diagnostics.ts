import { useWalletStore } from './walletStore';
import { getAppUserRole } from './app-role';

export interface ClientDeviceState {
  userAgent: string;
  language: string;
  screenWidth?: number;
  screenHeight?: number;
  timezone: string;
  mockMode: boolean;
  userRole: string;
  wallet: {
    connected: boolean;
    publicKeySanitized: string | null;
    network: string | null;
  };
}

export interface SupportDiagnosticsBundle {
  timestamp: string;
  appVersion: string;
  environment: string;
  clientState: ClientDeviceState;
  backendDiagnostics: Record<string, unknown> | null;
  queueHealth: Record<string, unknown> | null;
  walletNetworkStatus: Record<string, unknown> | null;
  recentErrors: Array<{ timestamp: string; message: string; source: string }>;
  sanitized: true;
}

const clientErrorLogs: Array<{ timestamp: string; message: string; source: string }> = [];

/**
 * Record a client-side error to the diagnostics log buffer
 */
export function recordClientError(message: string, source: string = 'client'): void {
  const sanitizedMsg = sanitizeClientString(message);
  clientErrorLogs.unshift({
    timestamp: new Date().toISOString(),
    message: sanitizedMsg,
    source,
  });

  if (clientErrorLogs.length > 15) {
    clientErrorLogs.pop();
  }
}

/**
 * Get recorded client errors
 */
export function getClientErrors(): Array<{ timestamp: string; message: string; source: string }> {
  return [...clientErrorLogs];
}

/**
 * Sanitizes strings for sensitive keys or patterns (private keys, secret seeds, auth headers, PII).
 */
export function sanitizeClientString(str: string): string {
  if (!str) return str;
  let result = str;

  // Redact Stellar Secret Keys (56 uppercase chars starting with S)
  result = result.replace(/\bS[A-Z0-9]{55}\b/g, '[REDACTED]');

  // Redact Bearer tokens / JWTs
  result = result.replace(/Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_=]*/gi, 'Bearer [REDACTED]');

  // Redact inline token/secret patterns (e.g. "token secret_abc123" or "password=123")
  result = result.replace(/\b(secret|token|password|bearer|api_key|apikey)[_=\s:]+[A-Za-z0-9-_.]+/gi, '$1 [REDACTED]');

  return result;
}

/**
 * Truncate public key for safe display/export (e.g. GABC12...890XYZ)
 */
export function sanitizePublicKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 12) return '[PUBLIC_KEY_MASKED]';
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

/**
 * Recursively sanitize objects for client diagnostics export
 */
export function sanitizeClientData<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') return sanitizeClientString(data) as T;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeClientData(item)) as unknown as T;
  }

  const sensitiveKeys = new Set([
    'password',
    'token',
    'secret',
    'authorization',
    'apikey',
    'api_key',
    'privatekey',
    'private_key',
    'seed',
    'ssn',
    'creditcard',
    'email',
  ]);

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (sensitiveKeys.has(k.toLowerCase())) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'string') {
      result[k] = sanitizeClientString(v);
    } else if (v !== null && typeof v === 'object') {
      result[k] = sanitizeClientData(v);
    } else {
      result[k] = v;
    }
  }

  return result as T;
}

/**
 * Gather full device diagnostics bundle including backend health/diagnostics if reachable
 */
export async function generateDeviceDiagnostics(): Promise<SupportDiagnosticsBundle> {
  const isBrowser = typeof window !== 'undefined';
  const walletState = useWalletStore.getState();

  const clientState: ClientDeviceState = {
    userAgent: isBrowser ? window.navigator.userAgent : 'Server environment',
    language: isBrowser ? window.navigator.language : 'en-US',
    screenWidth: isBrowser ? window.innerWidth : undefined,
    screenHeight: isBrowser ? window.innerHeight : undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    mockMode: process.env.NEXT_PUBLIC_USE_MOCKS === 'true',
    userRole: getAppUserRole(),
    wallet: {
      connected: Boolean(walletState.publicKey),
      publicKeySanitized: sanitizePublicKey(walletState.publicKey),
      network: walletState.network ?? 'testnet',
    },
  };

  let backendDiagnostics: Record<string, unknown> | null = null;
  let queueHealth: Record<string, unknown> | null = null;
  let walletNetworkStatus: Record<string, unknown> | null = null;

  try {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const res = await fetch(`${backendUrl}/api/v1/diagnostics/export`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });

    if (res.ok) {
      const data = await res.json();
      backendDiagnostics = sanitizeClientData(data);
      if (data.queueHealth) queueHealth = data.queueHealth;
      if (data.walletNetworkStatus) walletNetworkStatus = data.walletNetworkStatus;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to reach backend diagnostics API';
    recordClientError(errorMsg, 'backend-diagnostics-fetch');
  }

  const rawBundle: SupportDiagnosticsBundle = {
    timestamp: new Date().toISOString(),
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    clientState,
    backendDiagnostics,
    queueHealth: queueHealth || { status: 'unavailable', note: 'Backend diagnostics unreachable' },
    walletNetworkStatus: walletNetworkStatus || {
      status: walletState.publicKey ? 'client-connected' : 'client-disconnected',
      network: walletState.network || 'testnet',
    },
    recentErrors: getClientErrors(),
    sanitized: true,
  };

  return sanitizeClientData(rawBundle);
}
