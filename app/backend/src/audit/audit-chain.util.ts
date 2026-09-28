import { createHash } from 'crypto';

/**
 * Pure helpers for the tamper-evident AuditLog hash chain.
 *
 * See docs/audit-log-integrity.md for the full scheme and its limits.
 */

/** Postgres BIGINT sequence values arrive through Prisma as BigInt. */
export type SequenceValue = bigint | number | string;

/** Genesis link value for the first entry of the chain. */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Stable, human-readable JSON serialization: object keys are sorted
 * recursively and output is pretty-printed, so equal logical values always
 * serialize identically regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value), null, 2);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      result[key] = sortDeep(record[key]);
    }
    return result;
  }
  return value;
}

/**
 * Serialize metadata to its canonical form. A string input is returned as-is
 * (assumed already canonical, e.g. read back from `metadataCanonical`);
 * anything else is canonicalized, with nullish values mapping to `null`.
 */
export function canonicalMetadata(
  metadata: unknown,
  canonical?: string | null,
): string {
  if (typeof canonical === 'string') return canonical;
  if (typeof metadata === 'string') return metadata;
  return canonicalJson(metadata ?? null);
}

/**
 * Order-insensitive deep equality for JSON values (objects compare
 * key-by-key regardless of order; arrays compare element-wise in order).
 * Used to cross-check the visible `metadata` JSON column against its
 * recorded canonical form, since Postgres JSONB does not preserve key order.
 */
export function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object') return a === b;
  if (typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    return a.every((value, index) => jsonDeepEqual(value, bb[index]));
  }
  const aa = a as Record<string, unknown>;
  const bb = b as Record<string, unknown>;
  const keysA = Object.keys(aa).sort();
  const keysB = Object.keys(bb).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (!jsonDeepEqual(aa[keysA[i]], bb[keysB[i]])) return false;
  }
  return true;
}

/** SHA-256 of the canonical metadata string. */
export function metadataHash(metadataCanonical: string): string {
  return createHash('sha256').update(metadataCanonical, 'utf8').digest('hex');
}

/**
 * Compute the entry hash for an audit entry.
 *
 * The payload is a JSON array rather than concatenated fields so the encoding
 * is length-delimited: no separator ambiguities between values.
 *
 * `prevHash` is mixed in as raw hex (it is always a fixed-length hex string),
 * not JSON-escaped, matching how it appears in the database.
 */
export function computeEntryHash(fields: {
  id: string;
  sequence: SequenceValue;
  prevHash: string | null;
  actorId: string;
  entity: string;
  entityId: string;
  action: string;
  timestamp: Date | string;
  metadataCanonical: string;
}): string {
  const prevHash = fields.prevHash ?? GENESIS_PREV_HASH;
  const timestamp =
    fields.timestamp instanceof Date
      ? fields.timestamp.toISOString()
      : String(fields.timestamp);
  const payload = JSON.stringify([
    'soter-audit-v1',
    String(fields.id),
    String(fields.sequence),
    prevHash,
    String(fields.actorId),
    String(fields.entity),
    String(fields.entityId),
    String(fields.action),
    timestamp,
    metadataHash(fields.metadataCanonical),
  ]);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Raised when a chain step fails its integrity checks. */
export class ChainVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainVerificationError';
  }
}

/**
 * Fold a chain step: recompute one entry's hash and check its linkage to the
 * expected predecessor hash.
 *
 * - `expectedPrevHash === null` → legacy/unsealed row: link checks are
 *   skipped (legacy rows carry no linkage); the hash is still recomputed and,
 *   when the row stores an `entryHash`, compared.
 * - `expectedPrevHash === GENESIS_PREV_HASH` → first sealed entry of the
 *   chain: its recorded `prevHash` must be the genesis value, so deletion or
 *   insertion at the head of the chain is detected.
 * - otherwise → the recorded `prevHash` must equal the previous sealed
 *   entry's hash, so middle insertions and deletions are detected.
 *
 * If the row already stores an `entryHash` it is compared against the
 * recomputed value, which detects content mutation.
 */
export function foldChainStep(
  expectedPrevHash: string | null,
  entry: {
    id: string;
    sequence: SequenceValue | null;
    prevHash: string | null;
    entryHash: string | null;
    actorId: string;
    entity: string;
    entityId: string;
    action: string;
    timestamp: Date | string;
    metadata?: unknown;
    metadataCanonical?: string | null;
  },
): { entryHash: string; metadataCanonical: string } {
  const metadataCanonical = canonicalMetadata(
    entry.metadata,
    entry.metadataCanonical,
  );
  const entryHash = computeEntryHash({
    id: entry.id,
    sequence: entry.sequence ?? 0,
    prevHash: entry.prevHash,
    actorId: entry.actorId,
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    timestamp: entry.timestamp,
    metadataCanonical,
  });

  if (expectedPrevHash !== null) {
    const recorded = entry.prevHash ?? GENESIS_PREV_HASH;
    if (recorded !== expectedPrevHash) {
      throw new ChainVerificationError(
        `broken link: entry ${entry.id} (seq ${entry.sequence ?? 'null'}) records prevHash ${recorded}, but the previous chain entry hashes to ${expectedPrevHash}`,
      );
    }
  }
  if (entry.entryHash !== null && entry.entryHash !== entryHash) {
    throw new ChainVerificationError(
      `entry ${entry.id} (seq ${entry.sequence ?? 'null'}) has an invalid entryHash: expected ${entryHash}, found ${entry.entryHash}`,
    );
  }
  return { entryHash, metadataCanonical };
}
