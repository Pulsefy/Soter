import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import * as path from 'path';

// Configuration constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const ALLOWED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.txt',
  '.doc',
  '.docx',
];

/**
 * Validates file extension against allowed list
 */
export function isValidExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

/**
 * Validates MIME type against allowed list
 */
export function isValidMimeType(mimetype: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimetype.toLowerCase());
}

/**
 * Validates filename is safe and not ambiguous
 */
export function isValidFilename(filename: string): boolean {
  if (!filename || filename.trim().length === 0) {
    return false;
  }

  // Check for path traversal attempts
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    return false;
  }

  // Check for null bytes
  if (filename.includes('\0')) {
    return false;
  }

  // Check filename length (max 255 characters)
  if (filename.length > 255) {
    return false;
  }

  return true;
}

/**
 * Multer options for evidence upload with security validations
 */
export const evidenceUploadOptions: MulterOptions = {
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // Only allow single file upload
    fieldNameSize: 100,
    fieldSize: 1024 * 1024, // 1MB for fields
  },
  storage: diskStorage({
    destination: './uploads/evidence',
    filename: (_req, file, cb) => {
      // Generate safe filename with UUID
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uniqueSuffix}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    // Validate filename
    if (!isValidFilename(file.originalname)) {
      cb(
        new BadRequestException(
          'Invalid filename. Filenames must be safe and not contain path traversal characters.',
        ),
        false,
      );
      return;
    }

    // Validate MIME type
    if (!isValidMimeType(file.mimetype)) {
      cb(
        new BadRequestException(
          `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
        ),
        false,
      );
      return;
    }

    // Validate file extension
    if (!isValidExtension(file.originalname)) {
      cb(
        new BadRequestException(
          `Invalid file extension. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}`,
        ),
        false,
      );
      return;
    }

    // All validations passed
    cb(null, true);
  },
};

/**
 * Error handler for multer errors
 */
export function handleMulterError(error: Error & { code?: string }): any {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new BadRequestException(
      `File size exceeds maximum limit of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    );
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return new BadRequestException('Only one file can be uploaded at a time');
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return new BadRequestException(
      'Unexpected file field. Use "file" as the field name',
    );
  }

  return error;
}
