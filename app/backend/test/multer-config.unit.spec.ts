import {
  isValidExtension,
  isValidMimeType,
  isValidFilename,
} from '../src/evidence/multer.config';

describe('Multer Config Validation Functions', () => {
  describe('isValidExtension', () => {
    it('should return true for allowed extensions', () => {
      expect(isValidExtension('file.jpg')).toBe(true);
      expect(isValidExtension('file.jpeg')).toBe(true);
      expect(isValidExtension('file.png')).toBe(true);
      expect(isValidExtension('file.gif')).toBe(true);
      expect(isValidExtension('file.webp')).toBe(true);
      expect(isValidExtension('file.pdf')).toBe(true);
      expect(isValidExtension('file.txt')).toBe(true);
      expect(isValidExtension('file.doc')).toBe(true);
      expect(isValidExtension('file.docx')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isValidExtension('file.JPG')).toBe(true);
      expect(isValidExtension('file.Pdf')).toBe(true);
      expect(isValidExtension('file.TXT')).toBe(true);
    });

    it('should return false for disallowed extensions', () => {
      expect(isValidExtension('file.exe')).toBe(false);
      expect(isValidExtension('file.php')).toBe(false);
      expect(isValidExtension('file.js')).toBe(false);
      expect(isValidExtension('file.sh')).toBe(false);
      expect(isValidExtension('file.bat')).toBe(false);
      expect(isValidExtension('file.html')).toBe(false);
      expect(isValidExtension('file.xml')).toBe(false);
    });

    it('should handle files without extensions', () => {
      expect(isValidExtension('README')).toBe(false);
    });
  });

  describe('isValidMimeType', () => {
    it('should return true for allowed MIME types', () => {
      expect(isValidMimeType('image/jpeg')).toBe(true);
      expect(isValidMimeType('image/png')).toBe(true);
      expect(isValidMimeType('image/gif')).toBe(true);
      expect(isValidMimeType('image/webp')).toBe(true);
      expect(isValidMimeType('application/pdf')).toBe(true);
      expect(isValidMimeType('text/plain')).toBe(true);
      expect(isValidMimeType('application/msword')).toBe(true);
      expect(
        isValidMimeType(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isValidMimeType('Image/JPEG')).toBe(true);
      expect(isValidMimeType('APPLICATION/PDF')).toBe(true);
      expect(isValidMimeType('Text/Plain')).toBe(true);
    });

    it('should return false for disallowed MIME types', () => {
      expect(isValidMimeType('application/x-executable')).toBe(false);
      expect(isValidMimeType('application/x-php')).toBe(false);
      expect(isValidMimeType('application/javascript')).toBe(false);
      expect(isValidMimeType('text/html')).toBe(false);
      expect(isValidMimeType('application/xml')).toBe(false);
      expect(isValidMimeType('application/zip')).toBe(false);
    });
  });

  describe('isValidFilename', () => {
    it('should return true for valid filenames', () => {
      expect(isValidFilename('document.pdf')).toBe(true);
      expect(isValidFilename('my-file.txt')).toBe(true);
      expect(isValidFilename('photo.jpg')).toBe(true);
      expect(isValidFilename('report_2024.docx')).toBe(true);
      expect(isValidFilename('file with spaces.png')).toBe(true);
    });

    it('should reject empty filenames', () => {
      expect(isValidFilename('')).toBe(false);
      expect(isValidFilename('   ')).toBe(false);
    });

    it('should reject filenames with path traversal', () => {
      expect(isValidFilename('../etc/passwd.txt')).toBe(false);
      expect(isValidFilename('..\\windows\\system32.txt')).toBe(false);
      expect(isValidFilename('file../name.txt')).toBe(false);
    });

    it('should reject filenames with forward slashes', () => {
      expect(isValidFilename('path/to/file.txt')).toBe(false);
      expect(isValidFilename('/etc/passwd.txt')).toBe(false);
    });

    it('should reject filenames with backslashes', () => {
      expect(isValidFilename('path\\to\\file.txt')).toBe(false);
      expect(isValidFilename('C:\\Windows\\file.txt')).toBe(false);
    });

    it('should reject filenames with null bytes', () => {
      expect(isValidFilename('file\0.txt')).toBe(false);
      expect(isValidFilename('name\0malicious.txt')).toBe(false);
    });

    it('should reject filenames longer than 255 characters', () => {
      const longFilename = 'a'.repeat(256) + '.txt';
      expect(isValidFilename(longFilename)).toBe(false);
    });

    it('should accept filenames at exactly 255 characters', () => {
      const maxFilename = 'a'.repeat(251) + '.txt'; // 251 + 4 = 255
      expect(isValidFilename(maxFilename)).toBe(true);
    });

    it('should handle Unicode characters', () => {
      expect(isValidFilename('文档.pdf')).toBe(true);
      expect(isValidFilename('документ.txt')).toBe(true);
      expect(isValidFilename('ファイル.jpg')).toBe(true);
    });

    it('should handle special characters (except path separators)', () => {
      expect(isValidFilename('file@name.txt')).toBe(true);
      expect(isValidFilename('file#name.txt')).toBe(true);
      expect(isValidFilename('file$name.txt')).toBe(true);
      expect(isValidFilename('file%name.txt')).toBe(true);
      expect(isValidFilename('file&name.txt')).toBe(true);
    });
  });
});
