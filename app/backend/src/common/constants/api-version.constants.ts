/**
 * API Version Constants
 *
 * This file contains all API version-related constants and utilities
 * to ensure consistent versioning across the application.
 */

/**
 * Current API versions
 */
export const API_VERSIONS = {
  V1: '1',
  V2: '2',
} as const;

/**
 * API version status
 */
export const API_VERSION_STATUS = {
  CURRENT: 'current',
  DEPRECATED: 'deprecated',
  SUNSET: 'sunset',
} as const;

/**
 * Version metadata type
 */
interface VersionMetadata {
  version: string;
  status: string;
  releasedAt: string;
  description: string;
  documentation: string;
}

/**
 * Version metadata for documentation and deprecation tracking
 */
export const VERSION_METADATA: Record<string, VersionMetadata> = {
  [API_VERSIONS.V1]: {
    version: API_VERSIONS.V1,
    status: API_VERSION_STATUS.CURRENT,
    releasedAt: '2025-01-01',
    description: 'Initial API version with core features',
    documentation: '/api/docs',
  },
};

/**
 * Deprecation policy constants
 */
export const DEPRECATION_POLICY = {
  /**
   * Duration (in months) that deprecated versions/endpoints remain available
   */
  DEPRECATION_PERIOD_MONTHS: 6,

  /**
   * HTTP header used to indicate deprecation
   */
  SUNSET_HEADER: 'Sunset',

  /**
   * HTTP header used to indicate deprecation warning
   */
  DEPRECATION_HEADER: 'Deprecation',

  /**
   * Link header for migration documentation
   */
  LINK_HEADER: 'Link',
} as const;

/**
 * Helper type for version strings
 */
export type ApiVersion = (typeof API_VERSIONS)[keyof typeof API_VERSIONS];

/**
 * Check if a version is deprecated
 */
export function isVersionDeprecated(version: string): boolean {
  const metadata = VERSION_METADATA[version];
  if (!metadata) {
    return false;
  }
  return metadata.status === API_VERSION_STATUS.DEPRECATED;
}

/**
 * Get version metadata
 */
export function getVersionMetadata(version: string): VersionMetadata | undefined {
  return VERSION_METADATA[version];
}

/**
 * Get sunset date for a deprecated version
 */
export function getSunsetDate(deprecationDate: Date): Date {
  const sunsetDate = new Date(deprecationDate);
  sunsetDate.setMonth(
    sunsetDate.getMonth() + DEPRECATION_POLICY.DEPRECATION_PERIOD_MONTHS,
  );
  return sunsetDate;
}
