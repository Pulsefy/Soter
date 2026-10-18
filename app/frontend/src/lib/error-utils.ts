import { ErrorCategory } from '@/types/error';

/**
 * Error payloads come from arbitrary backend responses, so the shape is only
 * known at the point of use — `unknown` forces consumers to narrow it.
 */
export type ErrorDetails = unknown;

/** Loose shape of the Error-ish objects this module inspects. */
interface ErrorLikeFields {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  errorCode?: unknown;
  correlationId?: unknown;
  correlation_id?: unknown;
  traceId?: unknown;
  trace_id?: unknown;
  requestId?: unknown;
  request_id?: unknown;
  canRetry?: unknown;
  retryable?: unknown;
  category?: unknown;
  details?: unknown;
  cause?: unknown;
}

const NON_RETRYABLE_STATUS_CODES = new Set([
  400, 401, 403, 404, 405, 406, 409, 410, 422,
]);

const NON_RETRYABLE_ERROR_CODES = new Set([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RECORD_NOT_FOUND',
  'INVALID_OPERATION',
  'ONCHAIN_NOT_AUTHORIZED',
  'ONCHAIN_PACKAGE_NOT_FOUND',
  'ONCHAIN_PACKAGE_EXPIRED',
  'ONCHAIN_INVALID_STATE',
  'EVIDENCE_INVALID_FILE_TYPE',
  'EVIDENCE_FILE_TOO_LARGE',
  'EVIDENCE_MISSING_FILE',
  'EVIDENCE_NOT_FOUND',
  'EVIDENCE_ACCESS_DENIED',
  'EVIDENCE_CORRUPT_FILE',
]);

export class ApiError extends Error {
  status?: number;
  code?: string;
  correlationId?: string;
  details?: ErrorDetails;

  constructor(message: string, status?: number, code?: string, correlationId?: string, details?: ErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
  }
}

export interface NormalizedError {
  message: string;
  category: ErrorCategory;
  code?: string;
  correlationId?: string;
  status?: number;
  details?: ErrorDetails;
  canRetry?: boolean;
}

function pickCorrelationIdFromRecord(record: unknown): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const fields = record as ErrorLikeFields & { error?: unknown };
  const candidate =
    fields.traceId ??
    fields.correlationId ??
    fields.correlation_id ??
    fields.trace_id ??
    fields.requestId ??
    fields.request_id;

  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }

  if (fields.error && typeof fields.error === 'object') {
    const nested = pickCorrelationIdFromRecord(fields.error);
    if (nested) return nested;
  }

  return undefined;
}

export function extractCorrelationId(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if (error instanceof ApiError && error.correlationId) {
    return error.correlationId;
  }

  const direct = pickCorrelationIdFromRecord(error);
  if (direct) return direct;

  const fields = error as ErrorLikeFields;
  const fromDetails = pickCorrelationIdFromRecord(fields.details);
  if (fromDetails) return fromDetails;

  const fromCause = pickCorrelationIdFromRecord(fields.cause);
  if (fromCause) return fromCause;

  return undefined;
}

export function categorizeError(error: unknown): ErrorCategory {
  if (!error) return 'unknown';

  if (typeof error === 'object') {
    const explicitCategory = (error as ErrorLikeFields).category;
    if (
      explicitCategory === 'wallet' ||
      explicitCategory === 'network' ||
      explicitCategory === 'server' ||
      explicitCategory === 'config' ||
      explicitCategory === 'unknown'
    ) {
      return explicitCategory;
    }

    const status = (error as ErrorLikeFields).status ?? (error as ErrorLikeFields).statusCode;
    if (typeof status === 'number' && status >= 500) {
      return 'server';
    }
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  // Config errors
  if (
    message.includes('misconfigured') ||
    message.includes('environment variable') ||
    message.includes('next_public_')
  ) {
    return 'config';
  }

  // Wallet errors
  if (
    message.includes('freighter') ||
    message.includes('wallet') ||
    message.includes('user declined') ||
    message.includes('signature') ||
    message.includes('permission')
  ) {
    return 'wallet';
  }

  // Network errors
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('failed to fetch') ||
    message.includes('connectivity') ||
    message.includes('dns') ||
    message.includes('abort')
  ) {
    return 'network';
  }

  // Server errors
  if (
    message.includes('server') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('unavailable') ||
    message.includes('bad gateway')
  ) {
    return 'server';
  }

  return 'unknown';
}

export function isRetrySafe(error: unknown, category?: ErrorCategory): boolean {
  const resolvedCategory = category ?? categorizeError(error);
  if (resolvedCategory === 'config') {
    return false;
  }

  if (error && typeof error === 'object') {
    const fields = error as ErrorLikeFields;
    if (typeof fields.canRetry === 'boolean') {
      return fields.canRetry;
    }
    if (typeof fields.retryable === 'boolean') {
      return fields.retryable;
    }

    const status = fields.status ?? fields.statusCode;
    if (typeof status === 'number' && NON_RETRYABLE_STATUS_CODES.has(status)) {
      return false;
    }

    const code = fields.code ?? fields.errorCode;
    if (typeof code === 'string' && NON_RETRYABLE_ERROR_CODES.has(code)) {
      return false;
    }
  }

  return true;
}

export async function extractApiError(response: Response): Promise<ApiError> {
  const status = response.status;
  const headerCorrelationId =
    response.headers.get('x-correlation-id') ||
    response.headers.get('x-request-id') ||
    response.headers.get('trace_id') ||
    response.headers.get('x-trace-id') ||
    undefined;

  let message = `API request failed with status ${status}`;
  let code: string | undefined;
  let details: ErrorDetails = null;
  let bodyCorrelationId: string | undefined;

  try {
    // Clone response so we can read body without consuming the main response stream
    const clonedRes = response.clone();
    const body = await clonedRes.json();
    if (body && typeof body === 'object') {
      if (typeof body.message === 'string') {
        message = body.message;
      } else if (Array.isArray(body.message)) {
        message = body.message.join(', ');
      } else if (
        body.error &&
        typeof body.error === 'object' &&
        typeof body.error.message === 'string'
      ) {
        message = body.error.message;
      }

      code =
        body.code ||
        body.errorCode ||
        (body.error && typeof body.error === 'object' ? body.error.code : undefined) ||
        undefined;
      bodyCorrelationId = pickCorrelationIdFromRecord(body);
      details = body.details || body;
    }
  } catch {
    try {
      const clonedRes = response.clone();
      const text = await clonedRes.text();
      if (text && text.trim().length > 0 && text.length < 200) {
        message = text;
      }
    } catch {
      // ignore parsing failures
    }
  }

  const correlationId = bodyCorrelationId || headerCorrelationId;
  return new ApiError(message, status, code, correlationId, details);
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof ApiError) {
    const category = categorizeError(error);
    const correlationId = extractCorrelationId(error);
    return {
      message: error.message,
      category,
      code: error.code,
      correlationId,
      status: error.status,
      details: error.details,
      canRetry: isRetrySafe(error, category),
    };
  }

  if (error instanceof Error) {
    const fields = error as Error & ErrorLikeFields;
    const status = fields.status ?? fields.statusCode;
    const code = fields.code ?? fields.errorCode;
    const correlationId = extractCorrelationId(error);
    const category = categorizeError(error);
    return {
      message: error.message,
      category,
      code: typeof code === 'string' ? code : undefined,
      status: typeof status === 'number' ? status : undefined,
      correlationId,
      details: fields.details,
      canRetry: isRetrySafe(error, category),
    };
  }

  if (typeof error === 'string') {
    const category = categorizeError(error);
    return {
      message: error,
      category,
      canRetry: isRetrySafe(error, category),
    };
  }

  if (error && typeof error === 'object') {
    const candidate = error as ErrorLikeFields & { message?: unknown };
    const message = typeof candidate.message === 'string' ? candidate.message : 'An unexpected error occurred.';
    const status = candidate.status ?? candidate.statusCode;
    const code = candidate.code ?? candidate.errorCode;
    const correlationId = extractCorrelationId(error);
    const category = categorizeError(error);
    return {
      message,
      category,
      code: typeof code === 'string' ? code : undefined,
      status: typeof status === 'number' ? status : undefined,
      correlationId,
      details: candidate.details,
      canRetry: isRetrySafe(error, category),
    };
  }

  return {
    message: 'An unexpected error occurred.',
    category: 'unknown',
    canRetry: true,
  };
}

