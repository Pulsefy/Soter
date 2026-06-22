import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { Request } from 'express';
import * as path from 'path';

/**
 * Hardened validation rules for evidence uploads.
 *
 * These constants and helpers centralise the size, MIME-type and extension
 * limits applied to every uploaded file so the controller, the Multer
 * interceptor and the tests all agree on a single source of truth.
 */

/** Name of the multipart form field that carries the uploaded file. */
export const UPLOAD_FIELD = 'file';

/** Maximum size, in bytes, of a single uploaded file (10 MB). */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Allow-list of accepted MIME types. */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'text/plain',
] as const;

/** Allow-list of accepted lower-cased file extensions (including the dot). */
export const ALLOWED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.pdf',
  '.txt',
] as const;

/** Maximum accepted length of an original filename. */
export const MAX_FILENAME_LENGTH = 255;

/**
 * Mapping of allowed extension -> the MIME types that are consistent with it.
 * Used to reject files whose declared extension and MIME type disagree
 * (e.g. `evil.txt` claiming to be `application/pdf`).
 */
const EXTENSION_MIME_MAP: Record<string, readonly string[]> = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.pdf': ['application/pdf'],
  '.txt': ['text/plain'],
};

/**
 * Leading "magic byte" signatures used to confirm that a file's real contents
 * match its declared type. This defends against a renamed/relabelled file
 * (e.g. an executable uploaded as `report.pdf`). `text/plain` has no reliable
 * signature, so it is validated as "not a known binary type" instead.
 */
const MAGIC_SIGNATURES: { mime: string; bytes: number[] }[] = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  {
    mime: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] }, // "GIF8"
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // "%PDF"
];

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Returns true when the filename is a safe, single-segment name: non-empty,
 * within the length limit, free of path separators, parent-directory
 * references, and control characters (including NUL).
 */
export function isSafeFilename(name: string): boolean {
  if (!name || name.length > MAX_FILENAME_LENGTH) return false;
  // Reject control characters (0x00-0x1f and 0x7f) which can corrupt
  // downstream filesystem, shell or header handling.
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  // Reject any path separators before normalising so "sub/dir/x" and
  // "..\\x" cannot slip through.
  if (name.includes('/') || name.includes('\\')) return false;
  // After taking the basename the value must be unchanged and must not be a
  // directory reference.
  const base = path.basename(name);
  if (base !== name || base === '.' || base === '..') return false;
  return true;
}

/**
 * Multer `fileFilter` enforcing the MIME and extension allow-lists and a safe
 * filename at the streaming stage, before the whole file is buffered. Rejected
 * files surface as a `BadRequestException` (400). MIME is checked before the
 * extension so an obviously bad content type is reported first.
 */
export function evidenceFileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!isSafeFilename(file.originalname)) {
    return cb(new BadRequestException('Invalid filename'), false);
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
    return cb(
      new BadRequestException(
        `Invalid MIME type: ${file.mimetype}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
      ),
      false,
    );
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ext || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return cb(
      new BadRequestException(
        `Invalid file extension: ${ext || '(none)'}. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}`,
      ),
      false,
    );
  }
  cb(null, true);
}

/**
 * Multer options applied to the evidence upload interceptor.
 *
 * `fileFilter` rejects disallowed MIME types/extensions and unsafe filenames at
 * the streaming stage, surfaced to the client as a 400. Size and file-count
 * limits are intentionally enforced in the request handler (via
 * {@link validateUploadedFile} and the controller's single-file guard) rather
 * than through Multer's own `limits`: the global exception filter maps any
 * non-HTTP error (such as a Multer `LIMIT_*` error) to a 500, so handling these
 * cases ourselves keeps every rejection a precise HTTP exception (413 / 400).
 */
export const evidenceMulterOptions = {
  fileFilter: evidenceFileFilter,
};

/** Describes a validated upload (returned for convenience / logging). */
export interface ValidatedFile {
  filename: string;
  size: number;
  mimetype: string;
  extension: string;
}

/**
 * Deep, content-aware validation of a fully buffered uploaded file. This runs
 * after Multer has accepted the stream and complements {@link evidenceFileFilter}
 * by inspecting the actual bytes:
 *
 *  - file presence and non-emptiness,
 *  - size ceiling (boundary-safe),
 *  - safe filename,
 *  - MIME allow-list,
 *  - extension allow-list,
 *  - extension/MIME consistency,
 *  - magic-byte signature matching the declared type.
 *
 * Throws {@link BadRequestException} (or {@link PayloadTooLargeException} for
 * oversized files) describing the first failure encountered.
 */
export function validateUploadedFile(
  file: Express.Multer.File | undefined,
): ValidatedFile {
  if (!file) {
    throw new BadRequestException('No file uploaded');
  }

  if (!file.buffer || file.size === 0 || file.buffer.length === 0) {
    throw new BadRequestException('Uploaded file is empty');
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new PayloadTooLargeException(
      `File too large. Maximum allowed size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
    );
  }

  if (!isSafeFilename(file.originalname)) {
    throw new BadRequestException('Invalid filename');
  }

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
    throw new BadRequestException(
      `Invalid MIME type: ${file.mimetype}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
    );
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!ext || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new BadRequestException(
      `Invalid file extension: ${ext || '(none)'}. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}`,
    );
  }

  const allowedForExt = EXTENSION_MIME_MAP[ext] ?? [];
  if (!allowedForExt.includes(file.mimetype)) {
    throw new BadRequestException(
      `Declared MIME type ${file.mimetype} does not match extension ${ext}`,
    );
  }

  assertContentMatchesType(file);

  return {
    filename: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
    extension: ext,
  };
}

/**
 * Confirms the file's leading bytes match its declared MIME type. For the
 * binary types we accept this checks the magic-byte signature; for `text/plain`
 * it rejects content that looks like a known binary format (a disguised
 * executable or document).
 */
function assertContentMatchesType(file: Express.Multer.File): void {
  const buffer = file.buffer;

  if (file.mimetype === 'text/plain') {
    // A text file must not begin with a known binary signature, and must not
    // contain a NUL byte in its leading bytes (a strong binary indicator).
    for (const sig of MAGIC_SIGNATURES) {
      if (startsWith(buffer, sig.bytes)) {
        throw new BadRequestException(
          'File contents do not match the declared text/plain type',
        );
      }
    }
    const sampleLen = Math.min(buffer.length, 512);
    for (let i = 0; i < sampleLen; i++) {
      if (buffer[i] === 0x00) {
        throw new BadRequestException(
          'File contents do not match the declared text/plain type',
        );
      }
    }
    return;
  }

  const signature = MAGIC_SIGNATURES.find(s => s.mime === file.mimetype);
  if (signature && !startsWith(buffer, signature.bytes)) {
    throw new BadRequestException(
      `File contents do not match the declared ${file.mimetype} type`,
    );
  }
}
