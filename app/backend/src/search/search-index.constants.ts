import { SearchIndexEntityType } from '@prisma/client';

/** Entity types the search index is built from, in processing order. */
export const SEARCH_INDEX_ENTITY_TYPES = [
  SearchIndexEntityType.campaign,
  SearchIndexEntityType.claim,
  SearchIndexEntityType.recipient,
  SearchIndexEntityType.verification,
] as const;

export const DEFAULT_SEARCH_INDEX_BATCH_SIZE = 100;
export const MIN_SEARCH_INDEX_BATCH_SIZE = 10;
export const MAX_SEARCH_INDEX_BATCH_SIZE = 1000;

/**
 * A build that has not heartbeated within this window is considered
 * abandoned (crashed or scaled-down process) and may be resumed or
 * superseded instead of rejecting further requests forever.
 */
export const SEARCH_INDEX_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Fixed Postgres advisory lock key used to serialize rebuild claims across
 * instances, so concurrent rebuild requests are rejected rather than
 * interleaved even when more than one backend replica is running.
 */
export const SEARCH_INDEX_ADVISORY_LOCK_KEY = 955_355_955;

export const SEARCH_INDEX_BUILD_MODE_REBUILD = 'rebuild';
export const SEARCH_INDEX_BUILD_MODE_DRY_RUN = 'dry_run';
