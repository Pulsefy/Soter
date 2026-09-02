/**
 * Canonical API Error Code Catalog
 *
 * This module defines the single canonical enumerated catalog of error codes
 * with stable machine-readable string identifiers used across backend, frontend,
 * and mobile clients.
 *
 * Naming convention: <DOMAIN>_<REASON> or <REASON> for generic HTTP/system codes.
 */

import {
  INTEGRATION_ERROR_CODES,
  AppException,
  type IntegrationErrorCode,
} from './integration-error-codes';

// Re-export integration codes and AppException for seamless imports
export { INTEGRATION_ERROR_CODES, AppException, type IntegrationErrorCode };

// ---------------------------------------------------------------------------
// Base / HTTP Error Codes
// ---------------------------------------------------------------------------
export const BASE_ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  CONFLICT: 'CONFLICT',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  BAD_GATEWAY: 'BAD_GATEWAY',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',
  TIMEOUT: 'TIMEOUT',
  INVALID_OPERATION: 'INVALID_OPERATION',
  DEPENDENCY_FAILURE: 'DEPENDENCY_FAILURE',
} as const;

// ---------------------------------------------------------------------------
// Validation Error Codes
// ---------------------------------------------------------------------------
export const VALIDATION_ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
} as const;

// ---------------------------------------------------------------------------
// Database / Persistence Error Codes
// ---------------------------------------------------------------------------
export const DATABASE_ERROR_CODES = {
  DATABASE_ERROR: 'DATABASE_ERROR',
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
  UNIQUE_CONSTRAINT_VIOLATION: 'UNIQUE_CONSTRAINT_VIOLATION',
  FOREIGN_KEY_VIOLATION: 'FOREIGN_KEY_VIOLATION',
  VALUE_TOO_LONG: 'VALUE_TOO_LONG',
} as const;

// ---------------------------------------------------------------------------
// Auth & Security Error Codes
// ---------------------------------------------------------------------------
export const AUTH_ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  API_KEY_NOT_FOUND: 'API_KEY_NOT_FOUND',
  API_KEY_REVOKED: 'API_KEY_REVOKED',
  API_KEY_EXPIRED: 'API_KEY_EXPIRED',
  API_KEY_INVALID: 'API_KEY_INVALID',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  SCOPE_REQUIRED: 'SCOPE_REQUIRED',
} as const;

// ---------------------------------------------------------------------------
// Domain: Claims & Campaigns Error Codes
// ---------------------------------------------------------------------------
export const DOMAIN_ERROR_CODES = {
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  CLAIM_ALREADY_CANCELLED: 'CLAIM_ALREADY_CANCELLED',
  CLAIM_ALREADY_REISSUED: 'CLAIM_ALREADY_REISSUED',
  CLAIM_EXPIRED: 'CLAIM_EXPIRED',
  CLAIM_INVALID_STATE: 'CLAIM_INVALID_STATE',
  CAMPAIGN_NOT_FOUND: 'CAMPAIGN_NOT_FOUND',
  CAMPAIGN_FUNDING_CAP_EXCEEDED: 'CAMPAIGN_FUNDING_CAP_EXCEEDED',
  CAMPAIGN_EXPIRED: 'CAMPAIGN_EXPIRED',
  CAMPAIGN_INACTIVE: 'CAMPAIGN_INACTIVE',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_INVALID_STATE: 'SESSION_INVALID_STATE',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  AUDIT_LOG_NOT_FOUND: 'AUDIT_LOG_NOT_FOUND',
} as const;

// ---------------------------------------------------------------------------
// Canonical Aggregated Catalog
// ---------------------------------------------------------------------------
export const ERROR_CODES = {
  ...BASE_ERROR_CODES,
  ...VALIDATION_ERROR_CODES,
  ...DATABASE_ERROR_CODES,
  ...AUTH_ERROR_CODES,
  ...DOMAIN_ERROR_CODES,
  ...INTEGRATION_ERROR_CODES,
} as const;

/**
 * Alias for ERROR_CODES representing the canonical API error code catalog
 */
export const API_ERROR_CODES = ERROR_CODES;

/**
 * String union of all valid error code identifiers
 */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Enumeration of error codes for typed client usage
 */
export enum ApiErrorCode {
  // Base / HTTP
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  CONFLICT = 'CONFLICT',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  BAD_GATEWAY = 'BAD_GATEWAY',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',
  TIMEOUT = 'TIMEOUT',
  INVALID_OPERATION = 'INVALID_OPERATION',
  DEPENDENCY_FAILURE = 'DEPENDENCY_FAILURE',

  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT = 'INVALID_FORMAT',

  // Database
  DATABASE_ERROR = 'DATABASE_ERROR',
  RECORD_NOT_FOUND = 'RECORD_NOT_FOUND',
  UNIQUE_CONSTRAINT_VIOLATION = 'UNIQUE_CONSTRAINT_VIOLATION',
  FOREIGN_KEY_VIOLATION = 'FOREIGN_KEY_VIOLATION',
  VALUE_TOO_LONG = 'VALUE_TOO_LONG',

  // Auth & Security
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  API_KEY_NOT_FOUND = 'API_KEY_NOT_FOUND',
  API_KEY_REVOKED = 'API_KEY_REVOKED',
  API_KEY_EXPIRED = 'API_KEY_EXPIRED',
  API_KEY_INVALID = 'API_KEY_INVALID',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  SCOPE_REQUIRED = 'SCOPE_REQUIRED',

  // Domain
  CLAIM_NOT_FOUND = 'CLAIM_NOT_FOUND',
  CLAIM_ALREADY_CANCELLED = 'CLAIM_ALREADY_CANCELLED',
  CLAIM_ALREADY_REISSUED = 'CLAIM_ALREADY_REISSUED',
  CLAIM_EXPIRED = 'CLAIM_EXPIRED',
  CLAIM_INVALID_STATE = 'CLAIM_INVALID_STATE',
  CAMPAIGN_NOT_FOUND = 'CAMPAIGN_NOT_FOUND',
  CAMPAIGN_FUNDING_CAP_EXCEEDED = 'CAMPAIGN_FUNDING_CAP_EXCEEDED',
  CAMPAIGN_EXPIRED = 'CAMPAIGN_EXPIRED',
  CAMPAIGN_INACTIVE = 'CAMPAIGN_INACTIVE',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_INVALID_STATE = 'SESSION_INVALID_STATE',
  INVALID_DATE_RANGE = 'INVALID_DATE_RANGE',
  AUDIT_LOG_NOT_FOUND = 'AUDIT_LOG_NOT_FOUND',

  // AI Integration
  AI_SERVICE_UNAVAILABLE = 'AI_SERVICE_UNAVAILABLE',
  AI_SERVICE_TIMEOUT = 'AI_SERVICE_TIMEOUT',
  AI_INVALID_RESPONSE = 'AI_INVALID_RESPONSE',
  AI_QUOTA_EXCEEDED = 'AI_QUOTA_EXCEEDED',
  AI_VERIFICATION_FAILED = 'AI_VERIFICATION_FAILED',

  // Onchain Integration
  ONCHAIN_NETWORK_UNREACHABLE = 'ONCHAIN_NETWORK_UNREACHABLE',
  ONCHAIN_TRANSACTION_TIMEOUT = 'ONCHAIN_TRANSACTION_TIMEOUT',
  ONCHAIN_TRANSACTION_FAILED = 'ONCHAIN_TRANSACTION_FAILED',
  ONCHAIN_CONTRACT_ERROR = 'ONCHAIN_CONTRACT_ERROR',
  ONCHAIN_INSUFFICIENT_FUNDS = 'ONCHAIN_INSUFFICIENT_FUNDS',
  ONCHAIN_PACKAGE_NOT_FOUND = 'ONCHAIN_PACKAGE_NOT_FOUND',
  ONCHAIN_PACKAGE_EXPIRED = 'ONCHAIN_PACKAGE_EXPIRED',
  ONCHAIN_INVALID_STATE = 'ONCHAIN_INVALID_STATE',
  ONCHAIN_NOT_AUTHORIZED = 'ONCHAIN_NOT_AUTHORIZED',
  ONCHAIN_CONTRACT_PAUSED = 'ONCHAIN_CONTRACT_PAUSED',
  ONCHAIN_TOKEN_TRANSFER_FAILED = 'ONCHAIN_TOKEN_TRANSFER_FAILED',
  ONCHAIN_RPC_ERROR = 'ONCHAIN_RPC_ERROR',

  // Evidence Integration
  EVIDENCE_UPLOAD_FAILED = 'EVIDENCE_UPLOAD_FAILED',
  EVIDENCE_INVALID_FILE_TYPE = 'EVIDENCE_INVALID_FILE_TYPE',
  EVIDENCE_FILE_TOO_LARGE = 'EVIDENCE_FILE_TOO_LARGE',
  EVIDENCE_MISSING_FILE = 'EVIDENCE_MISSING_FILE',
  EVIDENCE_NOT_FOUND = 'EVIDENCE_NOT_FOUND',
  EVIDENCE_ACCESS_DENIED = 'EVIDENCE_ACCESS_DENIED',
  EVIDENCE_CORRUPT_FILE = 'EVIDENCE_CORRUPT_FILE',

  // Webhooks Integration
  WEBHOOK_DUPLICATE_EVENT = 'WEBHOOK_DUPLICATE_EVENT',
  WEBHOOK_SESSION_NOT_FOUND = 'WEBHOOK_SESSION_NOT_FOUND',
  WEBHOOK_STEP_NOT_FOUND = 'WEBHOOK_STEP_NOT_FOUND',
  WEBHOOK_INVALID_SIGNATURE = 'WEBHOOK_INVALID_SIGNATURE',
  WEBHOOK_DELIVERY_FAILED = 'WEBHOOK_DELIVERY_FAILED',
  WEBHOOK_INVALID_PAYLOAD = 'WEBHOOK_INVALID_PAYLOAD',
}

/**
 * Map HTTP status codes to standard catalog error codes
 */
export function getErrorCodeFromStatus(status: number): ErrorCode {
  const statusMap: Record<number, ErrorCode> = {
    400: ERROR_CODES.BAD_REQUEST,
    401: ERROR_CODES.UNAUTHORIZED,
    403: ERROR_CODES.FORBIDDEN,
    404: ERROR_CODES.NOT_FOUND,
    405: ERROR_CODES.METHOD_NOT_ALLOWED,
    409: ERROR_CODES.CONFLICT,
    422: ERROR_CODES.VALIDATION_ERROR,
    429: ERROR_CODES.RATE_LIMIT_EXCEEDED,
    500: ERROR_CODES.INTERNAL_SERVER_ERROR,
    501: ERROR_CODES.NOT_IMPLEMENTED,
    502: ERROR_CODES.BAD_GATEWAY,
    503: ERROR_CODES.SERVICE_UNAVAILABLE,
    504: ERROR_CODES.GATEWAY_TIMEOUT,
  };
  return statusMap[status] || ERROR_CODES.INTERNAL_SERVER_ERROR;
}

/**
 * Metadata descriptor for an error code
 */
export interface ErrorCodeDescriptor {
  code: ErrorCode;
  httpStatus: number;
  description: string;
}

/**
 * Catalog metadata mapping error codes to default HTTP statuses and descriptions
 */
export const ERROR_CODE_METADATA: Record<ErrorCode, ErrorCodeDescriptor> = {
  [ERROR_CODES.BAD_REQUEST]: {
    code: ERROR_CODES.BAD_REQUEST,
    httpStatus: 400,
    description: 'The request could not be understood or was missing required parameters',
  },
  [ERROR_CODES.UNAUTHORIZED]: {
    code: ERROR_CODES.UNAUTHORIZED,
    httpStatus: 401,
    description: 'Authentication is required and has failed or has not been provided',
  },
  [ERROR_CODES.FORBIDDEN]: {
    code: ERROR_CODES.FORBIDDEN,
    httpStatus: 403,
    description: 'The authenticated user does not have permission to access this resource',
  },
  [ERROR_CODES.NOT_FOUND]: {
    code: ERROR_CODES.NOT_FOUND,
    httpStatus: 404,
    description: 'The requested resource was not found',
  },
  [ERROR_CODES.METHOD_NOT_ALLOWED]: {
    code: ERROR_CODES.METHOD_NOT_ALLOWED,
    httpStatus: 405,
    description: 'The HTTP method is not supported for this endpoint',
  },
  [ERROR_CODES.CONFLICT]: {
    code: ERROR_CODES.CONFLICT,
    httpStatus: 409,
    description: 'The request conflicts with the current state of the target resource',
  },
  [ERROR_CODES.UNPROCESSABLE_ENTITY]: {
    code: ERROR_CODES.UNPROCESSABLE_ENTITY,
    httpStatus: 422,
    description: 'The request was well-formed but was unable to be followed due to semantic errors',
  },
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]: {
    code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
    httpStatus: 429,
    description: 'Too many requests were sent within a given time window',
  },
  [ERROR_CODES.INTERNAL_SERVER_ERROR]: {
    code: ERROR_CODES.INTERNAL_SERVER_ERROR,
    httpStatus: 500,
    description: 'An unexpected internal server error occurred',
  },
  [ERROR_CODES.NOT_IMPLEMENTED]: {
    code: ERROR_CODES.NOT_IMPLEMENTED,
    httpStatus: 501,
    description: 'The requested functionality is not yet implemented',
  },
  [ERROR_CODES.BAD_GATEWAY]: {
    code: ERROR_CODES.BAD_GATEWAY,
    httpStatus: 502,
    description: 'Received an invalid response from an upstream server',
  },
  [ERROR_CODES.SERVICE_UNAVAILABLE]: {
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    httpStatus: 503,
    description: 'The service is temporarily unavailable or undergoing maintenance',
  },
  [ERROR_CODES.GATEWAY_TIMEOUT]: {
    code: ERROR_CODES.GATEWAY_TIMEOUT,
    httpStatus: 504,
    description: 'An upstream server failed to send a response in time',
  },
  [ERROR_CODES.TIMEOUT]: {
    code: ERROR_CODES.TIMEOUT,
    httpStatus: 504,
    description: 'The operation timed out',
  },
  [ERROR_CODES.INVALID_OPERATION]: {
    code: ERROR_CODES.INVALID_OPERATION,
    httpStatus: 400,
    description: 'The requested operation is not valid for the current resource state',
  },
  [ERROR_CODES.DEPENDENCY_FAILURE]: {
    code: ERROR_CODES.DEPENDENCY_FAILURE,
    httpStatus: 502,
    description: 'A required downstream service failed to execute properly',
  },
  [ERROR_CODES.VALIDATION_ERROR]: {
    code: ERROR_CODES.VALIDATION_ERROR,
    httpStatus: 422,
    description: 'Input payload failed schema validation',
  },
  [ERROR_CODES.INVALID_INPUT]: {
    code: ERROR_CODES.INVALID_INPUT,
    httpStatus: 400,
    description: 'Supplied input parameters are invalid',
  },
  [ERROR_CODES.MISSING_REQUIRED_FIELD]: {
    code: ERROR_CODES.MISSING_REQUIRED_FIELD,
    httpStatus: 400,
    description: 'One or more required fields are missing from the request',
  },
  [ERROR_CODES.INVALID_FORMAT]: {
    code: ERROR_CODES.INVALID_FORMAT,
    httpStatus: 400,
    description: 'Data format is invalid or cannot be parsed',
  },
  [ERROR_CODES.DATABASE_ERROR]: {
    code: ERROR_CODES.DATABASE_ERROR,
    httpStatus: 500,
    description: 'A database error occurred while executing the query',
  },
  [ERROR_CODES.RECORD_NOT_FOUND]: {
    code: ERROR_CODES.RECORD_NOT_FOUND,
    httpStatus: 404,
    description: 'The database record was not found',
  },
  [ERROR_CODES.UNIQUE_CONSTRAINT_VIOLATION]: {
    code: ERROR_CODES.UNIQUE_CONSTRAINT_VIOLATION,
    httpStatus: 409,
    description: 'A resource with unique properties already exists',
  },
  [ERROR_CODES.FOREIGN_KEY_VIOLATION]: {
    code: ERROR_CODES.FOREIGN_KEY_VIOLATION,
    httpStatus: 400,
    description: 'Referenced foreign key entity does not exist',
  },
  [ERROR_CODES.VALUE_TOO_LONG]: {
    code: ERROR_CODES.VALUE_TOO_LONG,
    httpStatus: 400,
    description: 'Field value exceeds maximum allowed length',
  },
  [ERROR_CODES.UNAUTHENTICATED]: {
    code: ERROR_CODES.UNAUTHENTICATED,
    httpStatus: 401,
    description: 'User is not authenticated',
  },
  [ERROR_CODES.INVALID_CREDENTIALS]: {
    code: ERROR_CODES.INVALID_CREDENTIALS,
    httpStatus: 401,
    description: 'Provided credentials are invalid',
  },
  [ERROR_CODES.TOKEN_EXPIRED]: {
    code: ERROR_CODES.TOKEN_EXPIRED,
    httpStatus: 401,
    description: 'Authentication token has expired',
  },
  [ERROR_CODES.INVALID_TOKEN]: {
    code: ERROR_CODES.INVALID_TOKEN,
    httpStatus: 401,
    description: 'Authentication token is malformed or invalid',
  },
  [ERROR_CODES.API_KEY_NOT_FOUND]: {
    code: ERROR_CODES.API_KEY_NOT_FOUND,
    httpStatus: 401,
    description: 'API key was not found',
  },
  [ERROR_CODES.API_KEY_REVOKED]: {
    code: ERROR_CODES.API_KEY_REVOKED,
    httpStatus: 401,
    description: 'API key has been revoked',
  },
  [ERROR_CODES.API_KEY_EXPIRED]: {
    code: ERROR_CODES.API_KEY_EXPIRED,
    httpStatus: 401,
    description: 'API key has expired',
  },
  [ERROR_CODES.API_KEY_INVALID]: {
    code: ERROR_CODES.API_KEY_INVALID,
    httpStatus: 401,
    description: 'API key is invalid or header format is incorrect',
  },
  [ERROR_CODES.INSUFFICIENT_PERMISSIONS]: {
    code: ERROR_CODES.INSUFFICIENT_PERMISSIONS,
    httpStatus: 403,
    description: 'User lacks required permissions or roles',
  },
  [ERROR_CODES.SCOPE_REQUIRED]: {
    code: ERROR_CODES.SCOPE_REQUIRED,
    httpStatus: 403,
    description: 'API key lacks the required scope for this operation',
  },
  [ERROR_CODES.CLAIM_NOT_FOUND]: {
    code: ERROR_CODES.CLAIM_NOT_FOUND,
    httpStatus: 404,
    description: 'Claim was not found',
  },
  [ERROR_CODES.CLAIM_ALREADY_CANCELLED]: {
    code: ERROR_CODES.CLAIM_ALREADY_CANCELLED,
    httpStatus: 400,
    description: 'Claim is already in cancelled state',
  },
  [ERROR_CODES.CLAIM_ALREADY_REISSUED]: {
    code: ERROR_CODES.CLAIM_ALREADY_REISSUED,
    httpStatus: 400,
    description: 'Claim has already been reissued',
  },
  [ERROR_CODES.CLAIM_EXPIRED]: {
    code: ERROR_CODES.CLAIM_EXPIRED,
    httpStatus: 400,
    description: 'Claim validity period has expired',
  },
  [ERROR_CODES.CLAIM_INVALID_STATE]: {
    code: ERROR_CODES.CLAIM_INVALID_STATE,
    httpStatus: 400,
    description: 'Claim is not in an actionable state for this operation',
  },
  [ERROR_CODES.CAMPAIGN_NOT_FOUND]: {
    code: ERROR_CODES.CAMPAIGN_NOT_FOUND,
    httpStatus: 404,
    description: 'Campaign was not found',
  },
  [ERROR_CODES.CAMPAIGN_FUNDING_CAP_EXCEEDED]: {
    code: ERROR_CODES.CAMPAIGN_FUNDING_CAP_EXCEEDED,
    httpStatus: 400,
    description: 'Campaign funding cap has been reached or exceeded',
  },
  [ERROR_CODES.CAMPAIGN_EXPIRED]: {
    code: ERROR_CODES.CAMPAIGN_EXPIRED,
    httpStatus: 400,
    description: 'Campaign has ended',
  },
  [ERROR_CODES.CAMPAIGN_INACTIVE]: {
    code: ERROR_CODES.CAMPAIGN_INACTIVE,
    httpStatus: 400,
    description: 'Campaign is not currently active',
  },
  [ERROR_CODES.SESSION_NOT_FOUND]: {
    code: ERROR_CODES.SESSION_NOT_FOUND,
    httpStatus: 404,
    description: 'Verification session not found',
  },
  [ERROR_CODES.SESSION_EXPIRED]: {
    code: ERROR_CODES.SESSION_EXPIRED,
    httpStatus: 400,
    description: 'Verification session has expired',
  },
  [ERROR_CODES.SESSION_INVALID_STATE]: {
    code: ERROR_CODES.SESSION_INVALID_STATE,
    httpStatus: 400,
    description: 'Verification session is not in a valid state',
  },
  [ERROR_CODES.INVALID_DATE_RANGE]: {
    code: ERROR_CODES.INVALID_DATE_RANGE,
    httpStatus: 400,
    description: 'Specified date query parameters are invalid or start date is after end date',
  },
  [ERROR_CODES.AUDIT_LOG_NOT_FOUND]: {
    code: ERROR_CODES.AUDIT_LOG_NOT_FOUND,
    httpStatus: 404,
    description: 'Audit log entry was not found',
  },
  // AI
  [ERROR_CODES.AI_SERVICE_UNAVAILABLE]: {
    code: ERROR_CODES.AI_SERVICE_UNAVAILABLE,
    httpStatus: 503,
    description: 'External AI/OCR service did not respond or circuit breaker is open',
  },
  [ERROR_CODES.AI_SERVICE_TIMEOUT]: {
    code: ERROR_CODES.AI_SERVICE_TIMEOUT,
    httpStatus: 504,
    description: 'AI service call exceeded timeout deadline',
  },
  [ERROR_CODES.AI_INVALID_RESPONSE]: {
    code: ERROR_CODES.AI_INVALID_RESPONSE,
    httpStatus: 502,
    description: 'AI service returned malformed or unexpected response',
  },
  [ERROR_CODES.AI_QUOTA_EXCEEDED]: {
    code: ERROR_CODES.AI_QUOTA_EXCEEDED,
    httpStatus: 429,
    description: 'AI provider quota or rate limit exceeded',
  },
  [ERROR_CODES.AI_VERIFICATION_FAILED]: {
    code: ERROR_CODES.AI_VERIFICATION_FAILED,
    httpStatus: 422,
    description: 'AI verification pipeline produced a low confidence or un-reviewable result',
  },
  // Onchain
  [ERROR_CODES.ONCHAIN_NETWORK_UNREACHABLE]: {
    code: ERROR_CODES.ONCHAIN_NETWORK_UNREACHABLE,
    httpStatus: 503,
    description: 'Soroban RPC endpoint could not be reached',
  },
  [ERROR_CODES.ONCHAIN_TRANSACTION_TIMEOUT]: {
    code: ERROR_CODES.ONCHAIN_TRANSACTION_TIMEOUT,
    httpStatus: 504,
    description: 'Blockchain transaction submission or polling timed out',
  },
  [ERROR_CODES.ONCHAIN_TRANSACTION_FAILED]: {
    code: ERROR_CODES.ONCHAIN_TRANSACTION_FAILED,
    httpStatus: 400,
    description: 'Onchain transaction execution failed or was rejected',
  },
  [ERROR_CODES.ONCHAIN_CONTRACT_ERROR]: {
    code: ERROR_CODES.ONCHAIN_CONTRACT_ERROR,
    httpStatus: 400,
    description: 'Smart contract returned an error',
  },
  [ERROR_CODES.ONCHAIN_INSUFFICIENT_FUNDS]: {
    code: ERROR_CODES.ONCHAIN_INSUFFICIENT_FUNDS,
    httpStatus: 400,
    description: 'Escrow or account has insufficient funds for operation',
  },
  [ERROR_CODES.ONCHAIN_PACKAGE_NOT_FOUND]: {
    code: ERROR_CODES.ONCHAIN_PACKAGE_NOT_FOUND,
    httpStatus: 404,
    description: 'Aid package not found on blockchain',
  },
  [ERROR_CODES.ONCHAIN_PACKAGE_EXPIRED]: {
    code: ERROR_CODES.ONCHAIN_PACKAGE_EXPIRED,
    httpStatus: 400,
    description: 'Aid package claim window is closed',
  },
  [ERROR_CODES.ONCHAIN_INVALID_STATE]: {
    code: ERROR_CODES.ONCHAIN_INVALID_STATE,
    httpStatus: 400,
    description: 'Invalid package state transition onchain',
  },
  [ERROR_CODES.ONCHAIN_NOT_AUTHORIZED]: {
    code: ERROR_CODES.ONCHAIN_NOT_AUTHORIZED,
    httpStatus: 403,
    description: 'Signer is not authorized for contract operation',
  },
  [ERROR_CODES.ONCHAIN_CONTRACT_PAUSED]: {
    code: ERROR_CODES.ONCHAIN_CONTRACT_PAUSED,
    httpStatus: 503,
    description: 'Smart contract is paused',
  },
  [ERROR_CODES.ONCHAIN_TOKEN_TRANSFER_FAILED]: {
    code: ERROR_CODES.ONCHAIN_TOKEN_TRANSFER_FAILED,
    httpStatus: 400,
    description: 'Token transfer failed on blockchain',
  },
  [ERROR_CODES.ONCHAIN_RPC_ERROR]: {
    code: ERROR_CODES.ONCHAIN_RPC_ERROR,
    httpStatus: 502,
    description: 'Soroban JSON-RPC error',
  },
  // Evidence
  [ERROR_CODES.EVIDENCE_UPLOAD_FAILED]: {
    code: ERROR_CODES.EVIDENCE_UPLOAD_FAILED,
    httpStatus: 500,
    description: 'Evidence file could not be stored or encrypted',
  },
  [ERROR_CODES.EVIDENCE_INVALID_FILE_TYPE]: {
    code: ERROR_CODES.EVIDENCE_INVALID_FILE_TYPE,
    httpStatus: 400,
    description: 'Evidence file MIME type or format is not supported',
  },
  [ERROR_CODES.EVIDENCE_FILE_TOO_LARGE]: {
    code: ERROR_CODES.EVIDENCE_FILE_TOO_LARGE,
    httpStatus: 413,
    description: 'Evidence file size exceeds allowed limit',
  },
  [ERROR_CODES.EVIDENCE_MISSING_FILE]: {
    code: ERROR_CODES.EVIDENCE_MISSING_FILE,
    httpStatus: 400,
    description: 'Multipart request missing required file',
  },
  [ERROR_CODES.EVIDENCE_NOT_FOUND]: {
    code: ERROR_CODES.EVIDENCE_NOT_FOUND,
    httpStatus: 404,
    description: 'Evidence record not found',
  },
  [ERROR_CODES.EVIDENCE_ACCESS_DENIED]: {
    code: ERROR_CODES.EVIDENCE_ACCESS_DENIED,
    httpStatus: 403,
    description: 'Access to evidence artifact is denied',
  },
  [ERROR_CODES.EVIDENCE_CORRUPT_FILE]: {
    code: ERROR_CODES.EVIDENCE_CORRUPT_FILE,
    httpStatus: 422,
    description: 'Evidence file content does not match declared MIME header',
  },
  // Webhooks
  [ERROR_CODES.WEBHOOK_DUPLICATE_EVENT]: {
    code: ERROR_CODES.WEBHOOK_DUPLICATE_EVENT,
    httpStatus: 409,
    description: 'Duplicate webhook event received (idempotency key matched)',
  },
  [ERROR_CODES.WEBHOOK_SESSION_NOT_FOUND]: {
    code: ERROR_CODES.WEBHOOK_SESSION_NOT_FOUND,
    httpStatus: 404,
    description: 'Session referenced in webhook was not found',
  },
  [ERROR_CODES.WEBHOOK_STEP_NOT_FOUND]: {
    code: ERROR_CODES.WEBHOOK_STEP_NOT_FOUND,
    httpStatus: 404,
    description: 'Verification step in webhook payload was not found',
  },
  [ERROR_CODES.WEBHOOK_INVALID_SIGNATURE]: {
    code: ERROR_CODES.WEBHOOK_INVALID_SIGNATURE,
    httpStatus: 401,
    description: 'Webhook HMAC signature verification failed',
  },
  [ERROR_CODES.WEBHOOK_DELIVERY_FAILED]: {
    code: ERROR_CODES.WEBHOOK_DELIVERY_FAILED,
    httpStatus: 502,
    description: 'Outbound webhook delivery failed after retries exhausted',
  },
  [ERROR_CODES.WEBHOOK_INVALID_PAYLOAD]: {
    code: ERROR_CODES.WEBHOOK_INVALID_PAYLOAD,
    httpStatus: 400,
    description: 'Webhook payload schema validation failed',
  },
};
