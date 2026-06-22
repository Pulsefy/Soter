/**
 * Wizard step identifiers for the VerificationFlow component.
 * The flow is strictly linear: upload → analysing → result.
 */
export type VerificationStep = 'upload' | 'analysing' | 'result';

/**
 * Payload returned by POST /api/v1/verification/start on success.
 * Both fields are rendered as-is per spec — no client-side transformation.
 */
export interface VerificationResult {
    /** Numeric or otherwise serialised score from the AI verification engine. */
    score: unknown;
    /** Risk classification string from the AI verification engine. */
    risk_level: unknown;
}

/**
 * Map of form field names to their inline validation error messages.
 * An empty object means the form is valid.
 */
export interface ValidationErrors {
    image?: string;
    text?: string;
    form?: string;
}

/**
 * Result of a client-side PII scan of the evidence text input.
 */
export interface PiiDetectionResult {
    /** Whether any PII pattern was matched. */
    detected: boolean;
    /** Human-readable label for the first detected PII type, when detected is true. */
    type?: string;
}
