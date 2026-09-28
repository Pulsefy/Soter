import { PayloadTooLargeException } from '@nestjs/common';

/**
 * Response size guardrails for evidence endpoints, which can return large
 * metadata payloads or artifact listings. Configurable via env so limits
 * can be tuned per deployment without a code change.
 */

/** Maximum size, in bytes, of a JSON response body (default 5 MB). */
export const MAX_RESPONSE_SIZE_BYTES = Number(
  process.env.EVIDENCE_MAX_RESPONSE_BYTES ?? 5 * 1024 * 1024,
);

/** Responses at or above this size are gzip-compressed (default 1 KB). */
export const COMPRESSION_THRESHOLD_BYTES = Number(
  process.env.EVIDENCE_COMPRESSION_THRESHOLD_BYTES ?? 1024,
);

/** Throws when a serialized response body exceeds the configured limit. */
export function assertResponseWithinLimit(bodySizeBytes: number): void {
  if (bodySizeBytes > MAX_RESPONSE_SIZE_BYTES) {
    throw new PayloadTooLargeException(
      `Response of ${bodySizeBytes} bytes exceeds the ${MAX_RESPONSE_SIZE_BYTES}-byte limit`,
    );
  }
}

export function shouldCompress(bodySizeBytes: number): boolean {
  return bodySizeBytes >= COMPRESSION_THRESHOLD_BYTES;
}
