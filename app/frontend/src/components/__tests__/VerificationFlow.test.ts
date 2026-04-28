/**
 * Unit tests for the pure logic functions exported by VerificationFlow.
 *
 * Covers:
 *  - validateUploadForm — all validation rules
 *  - detectPii — all PII pattern categories
 *
 * stripExif relies on browser Canvas APIs (createImageBitmap, HTMLCanvasElement)
 * which are unavailable in the Node.js test environment; it is covered by
 * manual integration testing documented in the walkthrough.
 */

import { detectPii, parseVerificationDraft, validateUploadForm } from '../VerificationFlow';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

/**
 * Creates a minimal File stub that satisfies the File interface used by
 * validateUploadForm without requiring jsdom or any browser globals.
 */
function makeFile(
    name: string,
    type: string,
    sizeBytes: number,
): File {
    const blob = new Blob([new Uint8Array(sizeBytes)], { type });
    return new File([blob], name, { type });
}

/* ─── validateUploadForm ─────────────────────────────────────────────────── */

describe('validateUploadForm', () => {
    it('returns a form error when both image and text are absent', () => {
        const errors = validateUploadForm(null, '');
        expect(errors.form).toBeDefined();
        expect(errors.image).toBeUndefined();
        expect(errors.text).toBeUndefined();
    });

    it('returns a form error when text is whitespace-only and no image', () => {
        const errors = validateUploadForm(null, '   \t\n  ');
        expect(errors.form).toBeDefined();
    });

    it('returns no errors for a valid PNG image with no text', () => {
        const file = makeFile('photo.png', 'image/png', 1024);
        const errors = validateUploadForm(file, '');
        expect(Object.keys(errors)).toHaveLength(0);
    });

    it('returns no errors for a valid JPEG image with no text', () => {
        const file = makeFile('photo.jpg', 'image/jpeg', 512);
        const errors = validateUploadForm(file, '');
        expect(Object.keys(errors)).toHaveLength(0);
    });

    it('returns no errors for a valid WebP image with no text', () => {
        const file = makeFile('photo.webp', 'image/webp', 2048);
        const errors = validateUploadForm(file, '');
        expect(Object.keys(errors)).toHaveLength(0);
    });

    it('returns no errors for valid text with no image', () => {
        const errors = validateUploadForm(null, 'This is a valid evidence description that is long enough.');
        expect(Object.keys(errors)).toHaveLength(0);
    });

    it('returns no errors when both a valid image and valid text are provided', () => {
        const file = makeFile('photo.png', 'image/png', 1024);
        const errors = validateUploadForm(file, 'This is a valid evidence description that is long enough.');
        expect(Object.keys(errors)).toHaveLength(0);
    });

    it('returns an image error for an unsupported MIME type (GIF)', () => {
        const file = makeFile('anim.gif', 'image/gif', 1024);
        const errors = validateUploadForm(file, '');
        expect(errors.image).toBeDefined();
        expect(errors.form).toBeUndefined();
    });

    it('returns an image error for an unsupported MIME type (PDF)', () => {
        const file = makeFile('doc.pdf', 'application/pdf', 1024);
        const errors = validateUploadForm(file, '');
        expect(errors.image).toBeDefined();
    });

    it('returns an image error when the file exceeds 5 MB', () => {
        const fiveMbPlusOne = 5 * 1024 * 1024 + 1;
        const file = makeFile('large.png', 'image/png', fiveMbPlusOne);
        const errors = validateUploadForm(file, '');
        expect(errors.image).toBeDefined();
        expect(errors.image).toMatch(/5 MB/i);
    });

    it('accepts an image that is exactly 5 MB', () => {
        const fiveMb = 5 * 1024 * 1024;
        const file = makeFile('exact.png', 'image/png', fiveMb);
        const errors = validateUploadForm(file, '');
        expect(errors.image).toBeUndefined();
    });

    it('returns a text error when the text is shorter than 20 characters', () => {
        const errors = validateUploadForm(null, 'Too short.');
        expect(errors.text).toBeDefined();
        expect(errors.text).toMatch(/20/);
    });

    it('returns a text error when text is exactly 19 characters (boundary)', () => {
        const errors = validateUploadForm(null, 'a'.repeat(19));
        expect(errors.text).toBeDefined();
    });

    it('returns no text error when text is exactly 20 characters (boundary)', () => {
        const errors = validateUploadForm(null, 'a'.repeat(20));
        expect(errors.text).toBeUndefined();
    });

    it('does not produce a text error for text that is only valid after trimming (trimmed >= 20 chars)', () => {
        const errors = validateUploadForm(null, '  ' + 'a'.repeat(20) + '  ');
        expect(errors.text).toBeUndefined();
    });

    it('returns independent errors for bad image MIME and short text simultaneously', () => {
        const file = makeFile('anim.gif', 'image/gif', 512);
        const errors = validateUploadForm(file, 'Short.');
        expect(errors.image).toBeDefined();
        expect(errors.text).toBeDefined();
        expect(errors.form).toBeUndefined();
    });
});

/* ─── detectPii ──────────────────────────────────────────────────────────── */

describe('detectPii', () => {
    it('returns detected: false for clean text', () => {
        const result = detectPii('I lost my home in the floods last week and need assistance.');
        expect(result.detected).toBe(false);
        expect(result.type).toBeUndefined();
    });

    it('detects an email address', () => {
        const result = detectPii('Contact me at alice@example.com for more details.');
        expect(result.detected).toBe(true);
        expect(result.type).toMatch(/email/i);
    });

    it('detects an email address with subdomain', () => {
        const result = detectPii('Reach out via support@mail.example.org please.');
        expect(result.detected).toBe(true);
        expect(result.type).toMatch(/email/i);
    });

    it('detects an international phone number', () => {
        const result = detectPii('Call me on +1 800 555 1234 any time.');
        expect(result.detected).toBe(true);
        expect(result.type).toMatch(/phone/i);
    });

    it('detects a local format phone number with separator', () => {
        const result = detectPii('My number is 07700 900000.');
        expect(result.detected).toBe(true);
        expect(result.type).toMatch(/phone/i);
    });

    it('detects a national ID / SSN pattern (9 digits)', () => {
        const result = detectPii('My ID number is 123456789.');
        expect(result.detected).toBe(true);
        expect(result.type).toMatch(/national|ssn/i);
    });

    it('detects a national ID pattern (12 digits)', () => {
        const result = detectPii('Reference code 123456789012 was issued.');
        expect(result.detected).toBe(true);
        expect(result.type).toMatch(/national|ssn/i);
    });

    it('does not flag a short number sequence (8 digits) as national ID', () => {
        const result = detectPii('Order reference 12345678 needs review.');
        expect(result.detected).toBe(false);
    });

    it('returns the first detected PII type when multiple types are present', () => {
        // Email appears first in the pattern list, so it should win
        const result = detectPii('Email: bob@test.com, phone: +44 7700 900000.');
        expect(result.detected).toBe(true);
        expect(result.type).toMatch(/email/i);
    });

    it('returns detected: false for empty string', () => {
        const result = detectPii('');
        expect(result.detected).toBe(false);
    });
});

describe('parseVerificationDraft', () => {
    it('returns null for missing draft', () => {
        expect(parseVerificationDraft(null)).toBeNull();
    });

    it('returns null for malformed JSON', () => {
        expect(parseVerificationDraft('{bad-json')).toBeNull();
    });

    it('returns null for invalid shape', () => {
        const draft = JSON.stringify({
            textInput: 'Sample',
            includeLocation: 'yes',
            locationPermission: 'granted',
            locationData: null,
        });
        expect(parseVerificationDraft(draft)).toBeNull();
    });

    it('parses a valid persisted draft', () => {
        const draft = JSON.stringify({
            textInput: 'Evidence details here',
            includeLocation: true,
            locationPermission: 'granted',
            locationData: {
                latitude: 12.34,
                longitude: 56.78,
                accuracy: 10,
            },
        });
        const parsed = parseVerificationDraft(draft);
        expect(parsed).toEqual({
            textInput: 'Evidence details here',
            includeLocation: true,
            locationPermission: 'granted',
            locationData: {
                latitude: 12.34,
                longitude: 56.78,
                accuracy: 10,
            },
        });
    });
});
