import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { Readable } from 'stream';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  evidenceFileFilter,
  isSafeFilename,
  validateExtensionForMime,
  validateFileContent,
  validateUploadedFile,
} from './file-validation';

/** Minimal valid magic-byte prefixes for each accepted binary type. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

function makeFile(
  overrides: Partial<Express.Multer.File> & { buffer: Buffer },
): Express.Multer.File {
  const { buffer, ...rest } = overrides;
  return {
    fieldname: 'file',
    originalname: 'evidence.txt',
    encoding: '7bit',
    mimetype: 'text/plain',
    size: buffer.length,
    buffer,
    stream: Readable.from(buffer),
    destination: '',
    filename: '',
    path: '',
    ...rest,
  };
}

describe('isSafeFilename', () => {
  it.each([
    ['evidence.txt', true],
    ['report.final.pdf', true],
    ['file.txt', true], // Fixed test parameter configuration assertion flag
    ['', false],
    ['../../etc/passwd', false],
    ['sub/dir/file.txt', false],
    ['..\\windows\\system32', false],
    ['file\n.txt', false],
    ['..', false],
    ['.', false],
    [`${'a'.repeat(300)}.txt`, false],
  ])('returns %s -> %s', (name, expected) => {
    expect(isSafeFilename(name)).toBe(expected);
  });
});

describe('validateUploadedFile', () => {
  it('accepts a valid text file', () => {
    const file = makeFile({
      originalname: 'evidence.txt',
      mimetype: 'text/plain',
      buffer: Buffer.from('plain evidence content'),
    });
    expect(() => validateUploadedFile(file)).not.toThrow();
  });

  describe('valid binary signatures', () => {
    it.each([
      ['e.png', 'image/png', PNG_MAGIC],
      ['e.jpg', 'image/jpeg', JPEG_MAGIC],
      ['e.gif', 'image/gif', GIF_MAGIC],
      ['e.pdf', 'application/pdf', PDF_MAGIC],
    ])('accepts %s with matching binary magic bytes', (name, mime, magic) => {
      const file = makeFile({
        originalname: name,
        mimetype: mime,
        buffer: Buffer.concat([magic, Buffer.alloc(16, 1)]),
      });
      expect(() => validateUploadedFile(file)).not.toThrow();
    });
  });

  it('rejects a missing file', () => {
    expect(() => validateUploadedFile(undefined)).toThrow(BadRequestException);
  });

  it('rejects an empty file', () => {
    const file = makeFile({ buffer: Buffer.alloc(0) });
    expect(() => validateUploadedFile(file)).toThrow(/empty/i);
  });

  describe('boundary sizes', () => {
    it('accepts a file exactly at the size limit', () => {
      const buffer = Buffer.alloc(MAX_FILE_SIZE, 0x61); // ASCII 'a'
      const file = makeFile({
        originalname: 'big.txt',
        mimetype: 'text/plain',
        buffer,
      });
      expect(() => validateUploadedFile(file)).not.toThrow();
    });

    it('rejects a file one byte over the limit', () => {
      const buffer = Buffer.alloc(MAX_FILE_SIZE + 1, 0x61);
      const file = makeFile({
        originalname: 'big.txt',
        mimetype: 'text/plain',
        buffer,
      });
      expect(() => validateUploadedFile(file)).toThrow(
        PayloadTooLargeException,
      );
    });

    it('rejects when the declared size exceeds the limit even if buffer is small', () => {
      const file = makeFile({
        originalname: 'big.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('small'),
        size: MAX_FILE_SIZE + 100,
      });
      expect(() => validateUploadedFile(file)).toThrow(
        PayloadTooLargeException,
      );
    });
  });

  describe('malicious / invalid MIME scenarios', () => {
    it('rejects a disallowed MIME type', () => {
      const file = makeFile({
        originalname: 'app.bin',
        mimetype: 'application/octet-stream',
        buffer: Buffer.from('data'),
      });
      expect(() => validateUploadedFile(file)).toThrow(BadRequestException);
    });

    it('rejects a disallowed extension even with an allowed MIME', () => {
      const file = makeFile({
        originalname: 'evil.exe',
        mimetype: 'text/plain',
        buffer: Buffer.from('MZ executable'),
      });
      expect(() => validateUploadedFile(file)).toThrow(/extension/i);
    });

    it('rejects extension/MIME mismatch (txt declared as pdf)', () => {
      const file = makeFile({
        originalname: 'note.txt',
        mimetype: 'application/pdf',
        buffer: Buffer.from('not really a pdf'),
      });
      expect(() => validateUploadedFile(file)).toThrow(/does not match/i);
    });

    it('rejects an executable disguised as a .txt file', () => {
      // ELF header bytes claiming to be plain text.
      const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x01, 0x01, 0x01, 0x00]);
      const file = makeFile({
        originalname: 'evidence.txt',
        mimetype: 'text/plain',
        buffer: elf,
      });
      expect(() => validateUploadedFile(file)).toThrow(BadRequestException);
    });

    it('rejects a PNG whose bytes are not actually a PNG', () => {
      const file = makeFile({
        originalname: 'fake.png',
        mimetype: 'image/png',
        buffer: Buffer.from('this is plain text pretending to be png'),
      });
      expect(() => validateUploadedFile(file)).toThrow(/do not match/i);
    });

    it('rejects a PDF whose bytes are not actually a PDF', () => {
      const file = makeFile({
        originalname: 'fake.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('GIF89a-ish'),
      });
      expect(() => validateUploadedFile(file)).toThrow(/do not match/i);
    });

    it('rejects an invalid filename (path traversal)', () => {
      const file = makeFile({
        originalname: '../../etc/passwd.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('content'),
      });
      expect(() => validateUploadedFile(file)).toThrow(/filename/i);
    });
  });
});

describe('evidenceFileFilter', () => {
  const run = (file: Partial<Express.Multer.File>) =>
    new Promise<{ err: Error | null; accept: boolean }>(resolve => {
      evidenceFileFilter({} as never, file, (err, accept) =>
        resolve({ err: err ? err : null, accept: !!accept }),
      );
    });

  it('accepts an allowed type/extension/filename', async () => {
    const { err, accept } = await run({
      originalname: 'evidence.png',
      mimetype: 'image/png',
    });
    expect(err).toBeNull();
    expect(accept).toBe(true);
  });

  it('rejects a disallowed extension', async () => {
    const { err, accept } = await run({
      originalname: 'evil.exe',
      mimetype: 'text/plain',
    });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(accept).toBe(false);
  });

  it('rejects a disallowed MIME type', async () => {
    const { err, accept } = await run({
      originalname: 'note.txt',
      mimetype: 'application/x-msdownload',
    });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(accept).toBe(false);
  });

  it('rejects an unsafe filename', async () => {
    const { err, accept } = await run({
      originalname: '../escape.txt',
      mimetype: 'text/plain',
    });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(accept).toBe(false);
  });
});

describe('validateExtensionForMime', () => {
  it('returns the extension for an allowed, consistent pair', () => {
    expect(validateExtensionForMime('evidence.png', 'image/png')).toBe('.png');
  });

  it('rejects a disallowed extension', () => {
    expect(() => validateExtensionForMime('evil.exe', 'text/plain')).toThrow(
      /extension/i,
    );
  });

  it('rejects an extension/mimeType mismatch', () => {
    expect(() =>
      validateExtensionForMime('note.txt', 'application/pdf'),
    ).toThrow(/does not match/i);
  });
});

describe('validateFileContent', () => {
  it('accepts declared metadata backed by matching bytes (upload-session path)', () => {
    const result = validateFileContent({
      filename: 'evidence.pdf',
      mimetype: 'application/pdf',
      size: PDF_MAGIC.length + 4,
      buffer: Buffer.concat([PDF_MAGIC, Buffer.alloc(4, 1)]),
    });
    expect(result).toMatchObject({
      filename: 'evidence.pdf',
      mimetype: 'application/pdf',
      extension: '.pdf',
    });
  });

  it('rejects reassembled content whose bytes do not match the declared type', () => {
    // Mirrors the upload-session finalize flow: client declares image/png up
    // front, but the actual assembled chunk bytes are not a PNG.
    expect(() =>
      validateFileContent({
        filename: 'evidence.png',
        mimetype: 'image/png',
        size: 20,
        buffer: Buffer.from('this is plain text pretending to be png'),
      }),
    ).toThrow(/do not match/i);
  });

  it('rejects a declared size over the limit', () => {
    expect(() =>
      validateFileContent({
        filename: 'big.txt',
        mimetype: 'text/plain',
        size: MAX_FILE_SIZE + 1,
        buffer: Buffer.alloc(MAX_FILE_SIZE + 1, 0x61),
      }),
    ).toThrow(PayloadTooLargeException);
  });
});

describe('allow-list constants', () => {
  it('exposes non-empty, consistent allow-lists', () => {
    expect(ALLOWED_MIME_TYPES.length).toBeGreaterThan(0);
    expect(ALLOWED_EXTENSIONS.length).toBeGreaterThan(0);
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
  });
});
