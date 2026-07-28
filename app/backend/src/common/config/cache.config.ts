/**
 * Cache TTL configuration for different response types
 * All values in seconds
 */
export const CACHE_TTL = {
  /**
   * Verification status/details - once decided, rarely changes
   * Default: 5 minutes
   */
  VERIFICATION_STATUS: parseInt(
    process.env.CACHE_TTL_VERIFICATION_STATUS || '300',
    10,
  ),

  /**
   * Verification metrics - aggregate counts, acceptable staleness
   * Default: 1 minute
   */
  VERIFICATION_METRICS: parseInt(
    process.env.CACHE_TTL_VERIFICATION_METRICS || '60',
    10,
  ),

  /**
   * Aid package details - changes only on blockchain events
   * Default: 5 minutes
   */
  AID_PACKAGE_DETAILS: parseInt(
    process.env.CACHE_TTL_AID_PACKAGE_DETAILS || '300',
    10,
  ),

  /**
   * Aid package statistics - aggregate data, high read volume
   * Default: 10 minutes
   */
  AID_PACKAGE_STATS: parseInt(
    process.env.CACHE_TTL_AID_PACKAGE_STATS || '600',
    10,
  ),

  /**
   * Transaction status - immutable once confirmed
   * Default: 30 minutes (very safe for confirmed txs)
   */
  TRANSACTION_STATUS: parseInt(
    process.env.CACHE_TTL_TRANSACTION_STATUS || '1800',
    10,
  ),

  /**
   * Global analytics - expensive queries, acceptable staleness
   * Default: 10 minutes
   */
  ANALYTICS_GLOBAL: parseInt(
    process.env.CACHE_TTL_ANALYTICS_GLOBAL || '600',
    10,
  ),

  /**
   * Map data - geographic aggregations, low change frequency
   * Default: 15 minutes
   */
  ANALYTICS_MAP_DATA: parseInt(
    process.env.CACHE_TTL_ANALYTICS_MAP_DATA || '900',
    10,
  ),

  /**
   * Internal notes - staff-only, rarely updated
   * Default: 2 minutes
   */
  INTERNAL_NOTES: parseInt(process.env.CACHE_TTL_INTERNAL_NOTES || '120', 10),

  /**
   * User verification history - append-only, safe to cache
   * Default: 3 minutes
   */
  USER_VERIFICATION_HISTORY: parseInt(
    process.env.CACHE_TTL_USER_VERIFICATION_HISTORY || '180',
    10,
  ),

  /**
   * AI task status - polled frequently during execution
   * Default: 30 seconds (short TTL for responsive updates)
   */
  AI_TASK_STATUS: parseInt(process.env.CACHE_TTL_AI_TASK_STATUS || '30', 10),
} as const;

/**
 * Cache configuration for testnet environments
 * More aggressive caching for testing with lower traffic
 */
export const TESTNET_CACHE_TTL = {
  ...CACHE_TTL,
  VERIFICATION_STATUS: 600, // 10 minutes
  AID_PACKAGE_STATS: 1200, // 20 minutes
  ANALYTICS_GLOBAL: 1800, // 30 minutes
} as const;

/**
 * Get cache TTL based on environment
 */
export function getCacheTTL() {
  const isTestnet =
    process.env.SOROBAN_NETWORK === 'testnet' ||
    process.env.NODE_ENV === 'test';
  return isTestnet ? TESTNET_CACHE_TTL : CACHE_TTL;
}
