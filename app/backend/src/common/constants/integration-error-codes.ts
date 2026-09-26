/**
 * Integration-specific error codes for AI, onchain, evidence, and webhook
 * subsystems.
 *
 * Naming convention: <DOMAIN>_<REASON>
 *
 * These codes extend the base ERROR_CODES map defined in error-response.dto.ts
 * and are the stable, machine-readable identifiers that frontend and mobile
 * clients should branch on.  HTTP status codes are advisory; these codes are
 * canonical.
 */

// ---------------------------------------------------------------------------
// AI / OCR integration
// ---------------------------------------------------------------------------

/**
 * AI_SERVICE_UNAVAILABLE – The external AI / OCR microservice did not respond
 * or the circuit-breaker is open.
 */
export const AI_SERVICE_UNAVAILABLE = 'AI_SERVICE_UNAVAILABLE' as const;

/**
 * AI_SERVICE_TIMEOUT – The AI service call exceeded the configured deadline.
 */
export const AI_SERVICE_TIMEOUT = 'AI_SERVICE_TIMEOUT' as const;

/**
 * AI_INVALID_RESPONSE – The AI service returned a response that could not be
 * parsed or did not conform to the expected schema.
 */
export const AI_INVALID_RESPONSE = 'AI_INVALID_RESPONSE' as const;

/**
 * AI_QUOTA_EXCEEDED – The LLM provider (e.g. OpenAI) rejected the request
 * because quota / rate limits were hit.
 */
export const AI_QUOTA_EXCEEDED = 'AI_QUOTA_EXCEEDED' as const;

/**
 * AI_VERIFICATION_FAILED – The AI verification pipeline completed but produced
 * a result that could not be applied (e.g. below-threshold confidence combined
 * with an un-reviewable state).
 */
export const AI_VERIFICATION_FAILED = 'AI_VERIFICATION_FAILED' as const;

// ---------------------------------------------------------------------------
// Onchain / Soroban integration
// ---------------------------------------------------------------------------

/**
 * ONCHAIN_NETWORK_UNREACHABLE – The Soroban RPC endpoint could not be reached
 * (ECONNREFUSED, ENOTFOUND, etc.).
 */
export const ONCHAIN_NETWORK_UNREACHABLE =
  'ONCHAIN_NETWORK_UNREACHABLE' as const;

/**
 * ONCHAIN_TRANSACTION_TIMEOUT – A blockchain operation (submission, polling)
 * exceeded the allowed time window.
 */
export const ONCHAIN_TRANSACTION_TIMEOUT =
  'ONCHAIN_TRANSACTION_TIMEOUT' as const;

/**
 * ONCHAIN_TRANSACTION_FAILED – A transaction was submitted but the contract
 * invocation returned an error or the transaction failed on-chain.
 */
export const ONCHAIN_TRANSACTION_FAILED = 'ONCHAIN_TRANSACTION_FAILED' as const;

/**
 * ONCHAIN_CONTRACT_ERROR – The AidEscrow contract rejected the operation with
 * a known contract-level error code.
 */
export const ONCHAIN_CONTRACT_ERROR = 'ONCHAIN_CONTRACT_ERROR' as const;

/**
 * ONCHAIN_INSUFFICIENT_FUNDS – The escrow does not have enough balance for the
 * requested operation.
 */
export const ONCHAIN_INSUFFICIENT_FUNDS = 'ONCHAIN_INSUFFICIENT_FUNDS' as const;

/**
 * ONCHAIN_PACKAGE_NOT_FOUND – The referenced aid package does not exist in the
 * contract storage.
 */
export const ONCHAIN_PACKAGE_NOT_FOUND = 'ONCHAIN_PACKAGE_NOT_FOUND' as const;

/**
 * ONCHAIN_PACKAGE_EXPIRED – The aid package's claim window has closed.
 */
export const ONCHAIN_PACKAGE_EXPIRED = 'ONCHAIN_PACKAGE_EXPIRED' as const;

/**
 * ONCHAIN_INVALID_STATE – The attempted state transition is not permitted for
 * the current package state.
 */
export const ONCHAIN_INVALID_STATE = 'ONCHAIN_INVALID_STATE' as const;

/**
 * ONCHAIN_NOT_AUTHORIZED – The signing key does not have permission to execute
 * the requested contract operation.
 */
export const ONCHAIN_NOT_AUTHORIZED = 'ONCHAIN_NOT_AUTHORIZED' as const;

/**
 * ONCHAIN_CONTRACT_PAUSED – The AidEscrow contract is administratively paused;
 * all write operations are blocked.
 */
export const ONCHAIN_CONTRACT_PAUSED = 'ONCHAIN_CONTRACT_PAUSED' as const;

/**
 * ONCHAIN_TOKEN_TRANSFER_FAILED – The on-chain token transfer instruction
 * failed (e.g. recipient's trustline missing, balance insufficient).
 */
export const ONCHAIN_TOKEN_TRANSFER_FAILED =
  'ONCHAIN_TOKEN_TRANSFER_FAILED' as const;

/**
 * ONCHAIN_RPC_ERROR – The Soroban JSON-RPC layer returned an error that does
 * not map to a more specific code above.
 */
export const ONCHAIN_RPC_ERROR = 'ONCHAIN_RPC_ERROR' as const;

// ---------------------------------------------------------------------------
// Evidence / file-upload integration
// ---------------------------------------------------------------------------

/**
 * EVIDENCE_UPLOAD_FAILED – The evidence file could not be stored locally or
 * encrypted before queuing.
 */
export const EVIDENCE_UPLOAD_FAILED = 'EVIDENCE_UPLOAD_FAILED' as const;

/**
 * EVIDENCE_INVALID_FILE_TYPE – The uploaded file's MIME type or extension is
 * not on the allow-list.
 */
export const EVIDENCE_INVALID_FILE_TYPE = 'EVIDENCE_INVALID_FILE_TYPE' as const;

/**
 * EVIDENCE_FILE_TOO_LARGE – The uploaded file exceeds the configured size
 * limit.
 */
export const EVIDENCE_FILE_TOO_LARGE = 'EVIDENCE_FILE_TOO_LARGE' as const;

/**
 * EVIDENCE_MISSING_FILE – The multipart request did not include the expected
 * file field.
 */
export const EVIDENCE_MISSING_FILE = 'EVIDENCE_MISSING_FILE' as const;

/**
 * EVIDENCE_NOT_FOUND – The requested evidence item does not exist or is not
 * owned by the requesting principal.
 */
export const EVIDENCE_NOT_FOUND = 'EVIDENCE_NOT_FOUND' as const;

/**
 * EVIDENCE_ACCESS_DENIED – The artifact token is invalid, expired, or does
 * not match the requested artifact.
 */
export const EVIDENCE_ACCESS_DENIED = 'EVIDENCE_ACCESS_DENIED' as const;

/**
 * EVIDENCE_CORRUPT_FILE – Magic-byte validation revealed the file content does
 * not match the declared MIME type.
 */
export const EVIDENCE_CORRUPT_FILE = 'EVIDENCE_CORRUPT_FILE' as const;

// ---------------------------------------------------------------------------
// Webhook / event-delivery integration
// ---------------------------------------------------------------------------

/**
 * WEBHOOK_DUPLICATE_EVENT – The incoming webhook event has already been
 * processed (idempotency guard hit).
 */
export const WEBHOOK_DUPLICATE_EVENT = 'WEBHOOK_DUPLICATE_EVENT' as const;

/**
 * WEBHOOK_SESSION_NOT_FOUND – The session referenced by the webhook payload
 * does not exist or is not in an actionable state.
 */
export const WEBHOOK_SESSION_NOT_FOUND = 'WEBHOOK_SESSION_NOT_FOUND' as const;

/**
 * WEBHOOK_STEP_NOT_FOUND – The target verification step referenced by the
 * webhook payload was not found in the session.
 */
export const WEBHOOK_STEP_NOT_FOUND = 'WEBHOOK_STEP_NOT_FOUND' as const;

/**
 * WEBHOOK_INVALID_SIGNATURE – The HMAC signature on the incoming webhook
 * request failed verification.
 */
export const WEBHOOK_INVALID_SIGNATURE = 'WEBHOOK_INVALID_SIGNATURE' as const;

/**
 * WEBHOOK_DELIVERY_FAILED – An outbound webhook could not be delivered to the
 * configured endpoint after all retries were exhausted.
 */
export const WEBHOOK_DELIVERY_FAILED = 'WEBHOOK_DELIVERY_FAILED' as const;

/**
 * WEBHOOK_INVALID_PAYLOAD – The webhook payload did not satisfy validation
 * rules (missing fields, bad types, etc.).
 */
export const WEBHOOK_INVALID_PAYLOAD = 'WEBHOOK_INVALID_PAYLOAD' as const;

// ---------------------------------------------------------------------------
// Aggregated map – import this to extend ERROR_CODES
// ---------------------------------------------------------------------------

/**
 * INTEGRATION_ERROR_CODES is the single source of truth for all
 * integration-specific error codes.  It is merged into the central ERROR_CODES
 * constant in error-response.dto.ts.
 *
 * @example
 * import { INTEGRATION_ERROR_CODES } from './integration-error-codes';
 * throw new AppException(INTEGRATION_ERROR_CODES.AI_SERVICE_UNAVAILABLE, 503,
 *   'AI service is temporarily unavailable');
 */
export const INTEGRATION_ERROR_CODES = {
  // AI
  AI_SERVICE_UNAVAILABLE,
  AI_SERVICE_TIMEOUT,
  AI_INVALID_RESPONSE,
  AI_QUOTA_EXCEEDED,
  AI_VERIFICATION_FAILED,
  // Onchain
  ONCHAIN_NETWORK_UNREACHABLE,
  ONCHAIN_TRANSACTION_TIMEOUT,
  ONCHAIN_TRANSACTION_FAILED,
  ONCHAIN_CONTRACT_ERROR,
  ONCHAIN_INSUFFICIENT_FUNDS,
  ONCHAIN_PACKAGE_NOT_FOUND,
  ONCHAIN_PACKAGE_EXPIRED,
  ONCHAIN_INVALID_STATE,
  ONCHAIN_NOT_AUTHORIZED,
  ONCHAIN_CONTRACT_PAUSED,
  ONCHAIN_TOKEN_TRANSFER_FAILED,
  ONCHAIN_RPC_ERROR,
  // Evidence
  EVIDENCE_UPLOAD_FAILED,
  EVIDENCE_INVALID_FILE_TYPE,
  EVIDENCE_FILE_TOO_LARGE,
  EVIDENCE_MISSING_FILE,
  EVIDENCE_NOT_FOUND,
  EVIDENCE_ACCESS_DENIED,
  EVIDENCE_CORRUPT_FILE,
  // Webhooks
  WEBHOOK_DUPLICATE_EVENT,
  WEBHOOK_SESSION_NOT_FOUND,
  WEBHOOK_STEP_NOT_FOUND,
  WEBHOOK_INVALID_SIGNATURE,
  WEBHOOK_DELIVERY_FAILED,
  WEBHOOK_INVALID_PAYLOAD,
} as const;

export type IntegrationErrorCode = keyof typeof INTEGRATION_ERROR_CODES;

// ---------------------------------------------------------------------------
// AppException – typed exception that carries a stable errorCode
// ---------------------------------------------------------------------------

/**
 * AppException is a typed NestJS-compatible exception that carries a stable
 * `errorCode` (one of the integration codes or base ERROR_CODES values) so
 * AllExceptionsFilter can emit it verbatim instead of inferring a code from
 * the HTTP status.
 *
 * @example
 * throw new AppException(
 *   INTEGRATION_ERROR_CODES.AI_SERVICE_UNAVAILABLE,
 *   503,
 *   'AI service is temporarily unavailable',
 *   { retryAfterSeconds: 30 },
 * );
 */
export class AppException extends Error {
  readonly errorCode: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    errorCode: string,
    statusCode: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppException';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
  }
}
