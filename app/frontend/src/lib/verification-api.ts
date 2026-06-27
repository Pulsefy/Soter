/**
 * API client for the AI evidence verification endpoint.
 *
 * Calls POST /api/v1/verification/start with a FormData payload
 * and returns a typed VerificationResult on success.
 *
 * Error handling contract:
 *   - 4xx  → throws VerificationApiError with the message from the response body
 *   - 5xx  → throws VerificationApiError with a generic user-safe message
 *   - network failure → throws VerificationApiError with a generic user-safe message
 */

import type { VerificationResult } from '@/types/verification';
import { ApiError, extractApiError } from './error-utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Typed error thrown by startEvidenceVerification on all failure paths.
 * Consumers can catch this and display `.message` directly in the UI.
 */
export class VerificationApiError extends ApiError {
    constructor(message: string, status?: number, correlationId?: string) {
        super(message, status, correlationId);
        this.name = 'VerificationApiError';
    }
}

/**
 * Posts the validated, PII-safe evidence payload to the verification API.
 *
 * @param payload - FormData containing an optional `image` file and/or
 *   optional `text` string field.
 * @returns Resolved VerificationResult containing `score` and `risk_level`.
 * @throws VerificationApiError on any failure — message is safe to display
 *   directly in the UI.
 */
export async function startEvidenceVerification(
    payload: FormData,
): Promise<VerificationResult> {
    let response: Response;

    try {
        response = await fetch(`${API_URL}/api/v1/verification/start`, {
            method: 'POST',
            body: payload,
        });
    } catch {
        throw new VerificationApiError(
            'Unable to reach the verification service. Please check your connection and try again.',
        );
    }

    if (response.ok) {
        const body = (await response.json()) as VerificationResult;
        return body;
    }

    const apiError = await extractApiError(response);
    let message = apiError.message;
    if (response.status >= 500) {
        message = 'The verification service is temporarily unavailable. Please try again in a moment.';
    } else if (response.status >= 400 && response.status < 500 && apiError.message.startsWith('API request failed')) {
        message = 'The verification request was rejected. Please review your evidence and try again.';
    }

    throw new VerificationApiError(message, apiError.status, apiError.correlationId);
}

