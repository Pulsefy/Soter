import { ErrorCategory } from '@/types/error';

export class ApiError extends Error {
  status?: number;
  code?: string;
  correlationId?: string;
  details?: any;

  constructor(message: string, status?: number, code?: string, correlationId?: string, details?: any) {
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
  details?: any;
}

export function categorizeError(error: unknown): ErrorCategory {
  if (!error) return 'unknown';

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

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

export async function extractApiError(response: Response): Promise<ApiError> {
  const status = response.status;
  const headerCorrelationId =
    response.headers.get('x-correlation-id') ||
    response.headers.get('x-request-id') ||
    response.headers.get('trace_id') ||
    undefined;

  let message = `API request failed with status ${status}`;
  let code: string | undefined;
  let details: any = null;
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
      }
      
      code = body.code || body.errorCode || undefined;
      bodyCorrelationId = body.traceId || body.correlationId || undefined;
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
    return {
      message: error.message,
      category: categorizeError(error),
      code: error.code,
      correlationId: error.correlationId,
      status: error.status,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    const status = (error as any).status || (error as any).statusCode;
    const code = (error as any).code || (error as any).errorCode;
    const correlationId = (error as any).correlationId || (error as any).traceId;
    return {
      message: error.message,
      category: categorizeError(error),
      code: typeof code === 'string' ? code : undefined,
      status: typeof status === 'number' ? status : undefined,
      correlationId: typeof correlationId === 'string' ? correlationId : undefined,
      details: (error as any).details,
    };
  }

  if (typeof error === 'string') {
    return {
      message: error,
      category: categorizeError(error),
    };
  }

  if (error && typeof error === 'object') {
    const candidate = error as Record<string, any>;
    const message = typeof candidate.message === 'string' ? candidate.message : 'An unexpected error occurred.';
    const status = candidate.status;
    const code = candidate.code || candidate.errorCode;
    const correlationId = candidate.correlationId || candidate.traceId;
    return {
      message,
      category: categorizeError(message),
      code: typeof code === 'string' ? code : undefined,
      status: typeof status === 'number' ? status : undefined,
      correlationId: typeof correlationId === 'string' ? correlationId : undefined,
      details: candidate.details,
    };
  }

  return {
    message: 'An unexpected error occurred.',
    category: 'unknown',
  };
}

