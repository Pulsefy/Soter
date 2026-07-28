/**
 * Client-safe environment configuration.
 * Only NEXT_PUBLIC_* variables are exposed; safe to use in the browser (no secrets).
 *
 * Call `validateEnv()` once at application startup (server-side) to fail fast
 * if any required variable is absent or obviously wrong.
 */

// ---------------------------------------------------------------------------
// Public (browser-safe) values
// ---------------------------------------------------------------------------

const isProd = process.env.NODE_ENV === 'production';

/** Stellar network: testnet, futurenet, mainnet, etc. */
export const stellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK ??
  process.env.NEXT_PUBLIC_NETWORK ??
  (isProd ? 'unknown' : 'testnet');

/**
 * The network the wallet must be on for on-chain actions to be allowed.
 * Compared case-insensitively against the Freighter-reported network string.
 */
export const EXPECTED_NETWORK = stellarNetwork;

/** Application environment label (e.g. dev, staging, prod). Optional. */
export const envName: string | null =
  process.env.NEXT_PUBLIC_ENV_NAME?.trim() ?? null;

/** Backend API base URL (browser-safe, no secret). */
export const apiUrl: string =
  process.env.NEXT_PUBLIC_API_URL ?? (isProd ? '' : 'http://localhost:4000');

/** Whether the reviewer demo-checklist route is enabled. Dev/internal only. */
export const enableDemoChecklist: boolean =
  process.env.NEXT_PUBLIC_ENABLE_DEMO_CHECKLIST === 'true';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface EnvValidationResult {
  /** true when all required variables are present and valid */
  ok: boolean;
  /** Names of variables that are missing or empty */
  missing: string[];
  /** Names of variables that have an obviously wrong value */
  invalid: string[];
}

/**
 * Describes a required public environment variable.
 * `validate` runs only when the value is non-empty (i.e. it checks format).
 */
interface EnvSpec {
  key: string;
  /** Human-readable label shown in the misconfigured-deployment page */
  label: string;
  /** Optional extra validator; return false to mark the value as invalid */
  validate?: (value: string) => boolean;
}

/** Required public environment variables for a correct Soter deployment. */
const REQUIRED_ENV_SPECS: EnvSpec[] = [
  {
    key: 'NEXT_PUBLIC_API_URL',
    label: 'Backend API URL',
    validate: (v) => v.startsWith('http://') || v.startsWith('https://'),
  },
  {
    key: 'NEXT_PUBLIC_STELLAR_NETWORK',
    label: 'Stellar network',
    validate: (v) =>
      ['testnet', 'futurenet', 'mainnet', 'standalone'].includes(
        v.toLowerCase(),
      ),
  },
];

/**
 * Validate required environment variables.
 *
 * Safe to call on the server **and** client (reads only NEXT_PUBLIC_* vars).
 * Does NOT throw — returns a result object so callers decide how to react.
 */
export function validateEnv(): EnvValidationResult {
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const spec of REQUIRED_ENV_SPECS) {
    const raw = process.env[spec.key]?.trim();
    if (!raw) {
      missing.push(spec.label);
    } else if (spec.validate && !spec.validate(raw)) {
      invalid.push(spec.label);
    }
  }

  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}
