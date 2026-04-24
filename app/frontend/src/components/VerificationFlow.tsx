'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { AppEmptyState } from '@/components/empty-state/AppEmptyState';
import { getAppUserRole, getSampleVerificationText, isOperationsRole } from '@/lib/app-role';
import { startEvidenceVerification, VerificationApiError } from '@/lib/verification-api';
import type {
    PiiDetectionResult,
    ValidationErrors,
    VerificationResult,
    VerificationStep,
} from '@/types/verification';
import { useActivity } from '@/hooks/useActivity';

/* ─── Accepted image MIME types ─────────────────────────────────────────── */

const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const ACCEPTED_MIME_SET: ReadonlySet<string> = new Set(ACCEPTED_MIME_TYPES);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_TEXT_LENGTH = 20;

/* ─── PII detection ─────────────────────────────────────────────────────── */

/**
 * Pattern set for common PII.
 * The phone regex requires either a leading '+' or explicit separators between
 * digit groups, so it cannot match bare digit strings — those are caught by
 * the national ID pattern which runs afterwards.
 */
const PII_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
    {
        label: 'email address',
        pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
    },
    {
        label: 'phone number',
        // Matches: +<digits>[separators, more digits] OR <digits><space/dash/dot><digits>
        // Requires an explicit '+' prefix OR a visible separator between digit groups.
        // This ensures bare digit strings (e.g. 123456789) are NOT matched.
        pattern: /\+\d[\d\s\-.()*#]{5,}|\b\d{2,}[\s\-.]\d[\d\s\-.]{3,}\d/,
    },
    {
        label: 'national ID or SSN',
        // Catches standalone numeric sequences of 9–12 digits with no separators.
        pattern: /\b\d{9,12}\b/,
    },
];

/**
 * Scans the supplied text for common PII patterns.
 * Returns the first match found; returns `detected: false` when clean.
 *
 * @param text - Raw text to scan.
 * @returns PiiDetectionResult indicating whether PII was found and which type.
 */
export function detectPii(text: string): PiiDetectionResult {
    for (const { label, pattern } of PII_PATTERNS) {
        if (pattern.test(text)) {
            return { detected: true, type: label };
        }
    }
    return { detected: false };
}

/* ─── Validation ────────────────────────────────────────────────────────── */

/**
 * Validates the Step 1 upload form fields.
 * Validation fires only when called (i.e. on submission attempt) — never on keystroke.
 *
 * Rules:
 *  - At least one of imageFile / text must be provided.
 *  - Image (if present): MIME must be PNG/JPEG/WebP and size ≤ 5 MB.
 *  - Text (if present): must not be whitespace-only, must be ≥ 20 characters.
 *
 * @param imageFile - Staged file from the image input, or null.
 * @param text - Value of the text evidence textarea.
 * @returns A ValidationErrors object; empty when the form is valid.
 */
export function validateUploadForm(
    imageFile: File | null,
    text: string,
): ValidationErrors {
    const errors: ValidationErrors = {};
    const hasImage = imageFile !== null;
    const trimmedText = text.trim();
    const hasText = trimmedText.length > 0;

    if (!hasImage && !hasText) {
        errors.form =
            'Please provide at least one piece of evidence — an image or a text description.';
        return errors;
    }

    if (hasImage) {
        if (!ACCEPTED_MIME_SET.has(imageFile.type)) {
            errors.image = 'Only PNG, JPEG, and WebP images are accepted.';
        } else if (imageFile.size > MAX_IMAGE_BYTES) {
            errors.image = 'Image must be 5 MB or smaller.';
        }
    }

    if (hasText && trimmedText.length < MIN_TEXT_LENGTH) {
        errors.text = `Text evidence must be at least ${MIN_TEXT_LENGTH} characters long.`;
    }

    return errors;
}

/* ─── EXIF stripping ────────────────────────────────────────────────────── */

/**
 * Re-encodes the supplied image through the browser Canvas API to strip EXIF
 * and other metadata before the file is sent to the API.
 *
 * This uses only Web APIs (no external dependencies).
 * Falls back to returning the original file if the canvas is unavailable.
 *
 * @param file - The original image file.
 * @returns A new File with metadata stripped, or the original on failure.
 */
async function stripExif(file: File): Promise<File> {
    try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            bitmap.close();
            return file;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        return await new Promise<File>((resolve) => {
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        resolve(file);
                        return;
                    }
                    resolve(new File([blob], file.name, { type: file.type }));
                },
                file.type,
                0.92,
            );
        });
    } catch (err) {
        console.warn('[VerificationFlow] EXIF strip failed — sending original file.', err);
        return file;
    }
}

/* ─── Initial state factory ─────────────────────────────────────────────── */

interface FlowState {
    step: VerificationStep;
    imageFile: File | null;
    textInput: string;
    includeLocation: boolean;
    locationPermission: LocationPermissionState;
    locationData: CapturedLocation | null;
    errors: ValidationErrors;
    apiError: string | null;
    result: VerificationResult | null;
}

/** Returns a clean initial state object. Used on mount and on reset. */
function initialState(): FlowState {
    return {
        step: 'upload',
        imageFile: null,
        textInput: '',
        includeLocation: false,
        locationPermission: 'idle',
        locationData: null,
        errors: {},
        apiError: null,
        result: null,
    };
}

type LocationPermissionState =
    | 'idle'
    | 'requesting'
    | 'granted'
    | 'denied'
    | 'unsupported'
    | 'error';

interface CapturedLocation {
    latitude: number;
    longitude: number;
    accuracy: number;
}

/* ─── VerificationFlow component ────────────────────────────────────────── */

/**
 * VerificationFlow — multi-step wizard for AI evidence upload and verification.
 *
 * Step 1 (upload):   Recipients provide an image and/or text evidence.
 * Step 2 (analysing): Evidence is posted to POST /api/v1/verification/start.
 * Step 3 (result):   The AI score and risk level are displayed.
 *
 * The component is fully self-contained: all state lives here, no global store,
 * no context provider, no external dependencies beyond the project's existing
 * dependency tree.
 */
export const VerificationFlow: React.FC = () => {
    const uid = useId();
    const { trackJob } = useActivity();

    const [step, setStep] = useState<VerificationStep>('upload');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [textInput, setTextInput] = useState('');
    const [includeLocation, setIncludeLocation] = useState(false);
    const [locationPermission, setLocationPermission] =
        useState<LocationPermissionState>('idle');
    const [locationData, setLocationData] = useState<CapturedLocation | null>(null);
    const [errors, setErrors] = useState<ValidationErrors>({});
    const [apiError, setApiError] = useState<string | null>(null);
    const [result, setResult] = useState<VerificationResult | null>(null);

    /**
     * Payload ref: stores the validated, PII-clean FormData to be sent when
     * the component transitions to the "analysing" step.
     */
    const pendingPayload = useRef<FormData | null>(null);

    /* ── Reset ─────────────────────────────────────────────────────────────── */

    /** Resets all state to the initial values, clearing all inputs and results. */
    const resetFlow = useCallback(() => {
        const s = initialState();
        setStep(s.step);
        setImageFile(s.imageFile);
        setTextInput(s.textInput);
        setIncludeLocation(s.includeLocation);
        setLocationPermission(s.locationPermission);
        setLocationData(s.locationData);
        setErrors(s.errors);
        setApiError(s.apiError);
        setResult(s.result);
        pendingPayload.current = null;
    }, []);

    const handleLocationConsentToggle = useCallback((checked: boolean) => {
        setIncludeLocation(checked);
        if (!checked) {
            setLocationPermission('idle');
            setLocationData(null);
        }
    }, []);

    const handleRequestLocation = useCallback(() => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            setLocationPermission('unsupported');
            return;
        }

        setLocationPermission('requesting');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setLocationData({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                });
                setLocationPermission('granted');
            },
            (positionError) => {
                if (positionError.code === positionError.PERMISSION_DENIED) {
                    setLocationPermission('denied');
                } else {
                    setLocationPermission('error');
                }
            },
            {
                enableHighAccuracy: false,
                timeout: 8000,
                maximumAge: 5 * 60 * 1000,
            },
        );
    }, []);

    /* ── Step 1 → submission handler ────────────────────────────────────────── */

    /**
     * Handles form submission attempt.
     * Runs validation and PII checks before advancing to the "analysing" step.
     */
    const handleSubmit = useCallback(
        async (e: React.FormEvent<HTMLFormElement>) => {
            e.preventDefault();

            // 1. Client-side field validation
            const validationErrors = validateUploadForm(imageFile, textInput);
            if (Object.keys(validationErrors).length > 0) {
                setErrors(validationErrors);
                return;
            }
            setErrors({});

            // 2. PII check on text
            const trimmedText = textInput.trim();
            if (trimmedText.length > 0) {
                const pii = detectPii(trimmedText);
                if (pii.detected) {
                    setErrors({
                        text: `Your text appears to contain a ${pii.type}. Please remove it before proceeding.`,
                    });
                    return;
                }
            }

            // 3. Build FormData — EXIF stripped
            const form = new FormData();
            if (imageFile) {
                const clean = await stripExif(imageFile);
                form.append('image', clean);
            }
            if (trimmedText.length > 0) {
                form.append('text', trimmedText);
            }
            if (includeLocation && locationPermission === 'granted' && locationData) {
                form.append('location_latitude', locationData.latitude.toString());
                form.append('location_longitude', locationData.longitude.toString());
                form.append('location_accuracy_meters', locationData.accuracy.toString());
            }
            pendingPayload.current = form;

            // 4. Advance to Step 2; the API call fires via useEffect below
            setApiError(null);
            setStep('analysing');
        },
        [imageFile, includeLocation, locationData, locationPermission, textInput],
    );

    /* ── Step 2 → API call ───────────────────────────────────────────────────── */

    useEffect(() => {
        if (step !== 'analysing') return;

        const payload = pendingPayload.current;
        if (!payload) {
            // Defensive: should never occur in normal flow
            setTimeout(() => setStep('upload'), 0);
            return;
        }

        let cancelled = false;

        (async () => {
          try {
            const data = await trackJob(
              'Evidence Verification',
              'Analyzing submitted evidence for authenticity',
              () => startEvidenceVerification(payload)
            );
            if (cancelled) return;
            setResult(data);
            setStep('result');
          } catch (err) {
            if (cancelled) return;
            if (err instanceof VerificationApiError) {
              setApiError(err.message);
            } else {
              setApiError(
                'An unexpected error occurred. Please try again.',
              );
            }
            pendingPayload.current = null;
            setStep('upload');
          }
        })();

        return () => {
            cancelled = true;
        };
    }, [step, trackJob]);

    /* ── Derived IDs ─────────────────────────────────────────────────────────── */

    const imageInputId = `${uid}-image`;
    const imageErrorId = `${uid}-image-error`;
    const textInputId = `${uid}-text`;
    const textErrorId = `${uid}-text-error`;
    const formErrorId = `${uid}-form-error`;

    /* ── Submit button disabled state ───────────────────────────────────────── */

    const canSubmit = imageFile !== null || textInput.trim().length > 0;

    /* ── Render ──────────────────────────────────────────────────────────────── */

    return (
        <div className="p-6 bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-100 dark:border-gray-800">
            {step === 'upload' && (
                <StepUpload
                    imageFile={imageFile}
                    textInput={textInput}
                    errors={errors}
                    apiError={apiError}
                    canSubmit={canSubmit}
                    imageInputId={imageInputId}
                    imageErrorId={imageErrorId}
                    textInputId={textInputId}
                    textErrorId={textErrorId}
                    formErrorId={formErrorId}
                    onImageChange={setImageFile}
                    onTextChange={setTextInput}
                    onSubmit={handleSubmit}
                    includeLocation={includeLocation}
                    locationPermission={locationPermission}
                    locationData={locationData}
                    onLocationConsentToggle={handleLocationConsentToggle}
                    onRequestLocation={handleRequestLocation}
                />
            )}

            {step === 'analysing' && <StepAnalysing />}

            {step === 'result' && result !== null && (
                <StepResult result={result} onReset={resetFlow} />
            )}
        </div>
    );
};

/* ─── Step 1 — Upload ───────────────────────────────────────────────────── */

interface StepUploadProps {
    imageFile: File | null;
    textInput: string;
    errors: ValidationErrors;
    apiError: string | null;
    canSubmit: boolean;
    imageInputId: string;
    imageErrorId: string;
    textInputId: string;
    textErrorId: string;
    formErrorId: string;
    onImageChange: (file: File | null) => void;
    onTextChange: (text: string) => void;
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    includeLocation: boolean;
    locationPermission: LocationPermissionState;
    locationData: CapturedLocation | null;
    onLocationConsentToggle: (checked: boolean) => void;
    onRequestLocation: () => void;
}

/**
 * Step 1 — Evidence upload form.
 * Renders image file input, text evidence textarea, and the submit button.
 * All inputs are accessible and keyboard-navigable.
 */
function StepUpload({
    imageFile,
    textInput,
    errors,
    apiError,
    canSubmit,
    imageInputId,
    imageErrorId,
    textInputId,
    textErrorId,
    formErrorId,
    onImageChange,
    onTextChange,
    onSubmit,
    includeLocation,
    locationPermission,
    locationData,
    onLocationConsentToggle,
    onRequestLocation,
}: StepUploadProps) {
    const role = getAppUserRole();
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] ?? null;
        onImageChange(file);
    };

    return (
        <form onSubmit={onSubmit} noValidate aria-label="Evidence upload form">
            <h2 className="text-lg font-semibold mb-4">Submit Evidence for Verification</h2>

            {!imageFile && textInput.trim().length === 0 && (
                <div className="mb-6">
                    <AppEmptyState
                        compact
                        eyebrow="No Evidence Added"
                        title={
                            isOperationsRole(role)
                                ? 'Start with sample evidence to review the verification experience'
                                : 'Start with a sample request if you want to explore the flow first'
                        }
                        description={
                            isOperationsRole(role)
                                ? 'Contributors can preload example text, attach a small test image, and walk through validation and result states without needing a live claimant record.'
                                : 'You can type your own request or use sample text to understand how verification behaves before real data is connected.'
                        }
                        actions={[
                            {
                                onClick: () => onTextChange(getSampleVerificationText(role)),
                                label: 'Insert sample evidence',
                                icon: 'sample',
                            },
                            { href: '/help', label: 'View help', icon: 'docs', variant: 'secondary' },
                        ]}
                    />
                </div>
            )}

            {/* API error from a previous attempt */}
            {apiError && (
                <div
                    role="alert"
                    className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 text-sm"
                >
                    {apiError}
                </div>
            )}

            {/* Form-level validation error (at-least-one rule) */}
            {errors.form && (
                <p
                    id={formErrorId}
                    role="alert"
                    className="mb-3 text-sm text-red-500 dark:text-red-400"
                >
                    {errors.form}
                </p>
            )}

            {/* ── Image upload ── */}
            <div className="mb-4">
                <label
                    htmlFor={imageInputId}
                    className="block text-sm font-medium mb-1"
                >
                    Evidence image{' '}
                    <span className="text-gray-400 dark:text-gray-500 font-normal">
                        (PNG, JPEG, or WebP — max 5 MB)
                    </span>
                </label>
                <input
                    id={imageInputId}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-describedby={errors.image ? imageErrorId : undefined}
                    aria-invalid={!!errors.image}
                    onChange={handleFileChange}
                    className="block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 dark:file:bg-gray-800 dark:file:text-gray-300 dark:hover:file:bg-gray-700 transition-colors cursor-pointer"
                />
                {imageFile && !errors.image && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Selected: {imageFile.name}
                    </p>
                )}
                {errors.image && (
                    <span
                        id={imageErrorId}
                        role="alert"
                        className="mt-1 block text-sm text-red-500 dark:text-red-400"
                    >
                        {errors.image}
                    </span>
                )}
            </div>

            {/* ── Text evidence ── */}
            <div className="mb-6">
                <label
                    htmlFor={textInputId}
                    className="block text-sm font-medium mb-1"
                >
                    Text evidence{' '}
                    <span className="text-gray-400 dark:text-gray-500 font-normal">
                        (min. 20 characters — do not include personal identifying information)
                    </span>
                </label>
                <textarea
                    id={textInputId}
                    value={textInput}
                    onChange={(e) => onTextChange(e.target.value)}
                    rows={4}
                    aria-describedby={errors.text ? textErrorId : undefined}
                    aria-invalid={!!errors.text}
                    placeholder="Describe your situation or the evidence supporting your request…"
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y transition-colors"
                />
                {errors.text && (
                    <span
                        id={textErrorId}
                        role="alert"
                        className="mt-1 block text-sm text-red-500 dark:text-red-400"
                    >
                        {errors.text}
                    </span>
                )}
            </div>

            <div className="mb-6 rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800/50">
                <label className="flex items-start gap-3">
                    <input
                        type="checkbox"
                        checked={includeLocation}
                        onChange={(e) => onLocationConsentToggle(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>
                        <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                            Share approximate location (optional)
                        </span>
                        <span className="block text-xs text-gray-600 dark:text-gray-400 mt-1">
                            We use this only to add context for field verification and delivery routing. Your request still works if you choose not to share.
                        </span>
                    </span>
                </label>

                {includeLocation && (
                    <div className="mt-3 space-y-2">
                        <button
                            type="button"
                            onClick={onRequestLocation}
                            disabled={locationPermission === 'requesting'}
                            className="px-3 py-1.5 text-xs font-medium rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60 disabled:cursor-not-allowed dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-200 dark:hover:bg-blue-900/60"
                        >
                            {locationPermission === 'requesting'
                                ? 'Requesting location...'
                                : 'Allow location access'}
                        </button>

                        {locationPermission === 'granted' && locationData && (
                            <p className="text-xs text-green-700 dark:text-green-300">
                                Location added (accuracy: ±{Math.round(locationData.accuracy)}m).
                            </p>
                        )}
                        {locationPermission === 'denied' && (
                            <p className="text-xs text-amber-700 dark:text-amber-300">
                                Location permission was denied. You can continue without it.
                            </p>
                        )}
                        {locationPermission === 'unsupported' && (
                            <p className="text-xs text-amber-700 dark:text-amber-300">
                                Location is not supported in this browser. You can continue without it.
                            </p>
                        )}
                        {locationPermission === 'error' && (
                            <p className="text-xs text-amber-700 dark:text-amber-300">
                                We couldn&apos;t capture your location right now. You can continue without it.
                            </p>
                        )}
                    </div>
                )}
            </div>

            <button
                type="submit"
                disabled={!canSubmit}
                aria-disabled={!canSubmit}
                className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
                Submit for Verification
            </button>
        </form>
    );
}

/* ─── Step 2 — Analysing ────────────────────────────────────────────────── */

/**
 * Step 2 — Analysing state.
 * Shows an indeterminate progress bar while the API call is in flight.
 * No interactive elements are rendered — the user cannot navigate back.
 */
function StepAnalysing() {
    return (
        <div className="flex flex-col items-center justify-center py-12 space-y-6">
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                Analysing...
            </p>
            <div
                role="progressbar"
                aria-label="Analysing evidence…"
                aria-valuemin={0}
                aria-valuemax={100}
                className="w-full max-w-sm h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
            >
                <div className="h-full w-1/2 rounded-full bg-blue-500 animate-[slide_1.4s_ease-in-out_infinite]" />
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
                Please wait while we analyse your evidence.
            </p>

            {/* Keyframe animation defined inline — avoids adding to globals.css */}
            <style>{`
        @keyframes slide {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(200%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
        </div>
    );
}

/* ─── Step 3 — Result ───────────────────────────────────────────────────── */

interface StepResultProps {
    result: VerificationResult;
    onReset: () => void;
}

/**
 * Step 3 — Verification result display.
 * Renders the score and risk_level from the API response without transformation.
 * Provides a reset button to start a new verification.
 */
function StepResult({ result, onReset }: StepResultProps) {
    return (
        <div className="space-y-6">
            <h2 className="text-lg font-semibold">Verification Result</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Score */}
                <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <p className="text-xs font-medium uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">
                        Score
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                        {String(result.score)}
                    </p>
                </div>

                {/* Risk Level */}
                <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <p className="text-xs font-medium uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">
                        Risk Level
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                        {String(result.risk_level)}
                    </p>
                </div>
            </div>

            <button
                type="button"
                onClick={onReset}
                aria-label="Start a new verification"
                className="px-6 py-2.5 border border-gray-300 dark:border-gray-700 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
            >
                Start New Verification
            </button>

            <Link
                href="/help"
                className="inline-flex items-center rounded-lg text-sm font-medium text-blue-600 hover:text-blue-700"
            >
                Review contributor help
            </Link>
        </div>
    );
}
