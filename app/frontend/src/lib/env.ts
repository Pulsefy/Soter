/**
 * Client-safe environment configuration.
 * Only NEXT_PUBLIC_* variables are exposed; safe to use in the browser (no secrets).
 */

/** Stellar network: testnet, futurenet, mainnet, etc. */
export const stellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK ??
  process.env.NEXT_PUBLIC_NETWORK ??
  'unknown';

/** Application environment label (e.g. dev, staging, prod). Optional. */
export const envName: string | null =
  process.env.NEXT_PUBLIC_ENV_NAME?.trim() ?? null;
