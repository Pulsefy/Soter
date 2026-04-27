import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { App } from 'supertest/types';

describe('Evidence Upload Validation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const uploadDir = path.join(process.cwd(), 'uploads', 'evidence');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.evidenceQueueItem.deleteMany();
    // Clean up upload directory
    try {
      const files = await fs.readdir(uploadDir);
      for (const file of files) {
        await fs.unlink(path.join(uploadDir, file));
      }
    } catch {
      // Ignore if dir doesn't exist
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('File size validation', () => {
    it('should reject files exceeding 10MB limit', async () => {
      // Create a file slightly larger than 10MB
      const largeFileContent = Buffer.alloc(11 * 1024 * 1024, 'a');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', largeFileContent, 'large-file.txt')
        .expect(400);

      expect(res.body.message).toContain('File size exceeds maximum limit');
    });

    it('should accept files at exactly 10MB boundary', async () => {
      // Create a file at exactly 10MB
      const boundaryFileContent = Buffer.alloc(10 * 1024 * 1024, 'b');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', boundaryFileContent, 'boundary-file.txt')
        .expect(201);

      expect(res.body.fileName).toBe('boundary-file.txt');
    });

    it('should accept small files', async () => {
      const smallFileContent = Buffer.from('small file content');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', smallFileContent, 'small.txt')
        .expect(201);

      expect(res.body.fileName).toBe('small.txt');
    });
  });

  describe('MIME type validation', () => {
    it('should reject executable files', async () => {
      const exeContent = Buffer.from('MZ executable content');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', exeContent, 'malware.exe')
        .expect(400);

      expect(res.body.message).toContain('Invalid file type');
    });

    it('should reject script files', async () => {
      const scriptContent = Buffer.from('#!/bin/bash\necho malicious');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', scriptContent, 'script.sh')
        .expect(400);

      expect(res.body.message).toContain('Invalid file');
    });

    it('should reject HTML files', async () => {
      const htmlContent = Buffer.from('<html><body>malicious</body></html>');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', htmlContent, 'page.html')
        .expect(400);

      expect(res.body.message).toContain('Invalid file');
    });

    it('should accept valid image files (JPEG)', async () => {
      // Minimal JPEG header
      const jpegContent = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
      ]);

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', jpegContent, 'photo.jpg')
        .expect(201);

      expect(res.body.fileName).toBe('photo.jpg');
    });

    it('should accept valid PDF files', async () => {
      const pdfContent = Buffer.from('%PDF-1.4 fake pdf content');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', pdfContent, 'document.pdf')
        .expect(201);

      expect(res.body.fileName).toBe('document.pdf');
    });
  });

  describe('File extension validation', () => {
    it('should reject files with disallowed extensions (.php)', async () => {
      const phpContent = Buffer.from('<?php echo "malicious"; ?>');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', phpContent, 'shell.php')
        .expect(400);

      expect(res.body.message).toContain('Invalid file');
    });

    it('should reject files with disallowed extensions (.js)', async () => {
      const jsContent = Buffer.from('console.log("malicious")');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', jsContent, 'script.js')
        .expect(400);

      expect(res.body.message).toContain('Invalid file');
    });

    it('should reject files with disallowed extensions (.bat)', async () => {
      const batContent = Buffer.from('@echo off\ndel /f /q *.*');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', batContent, 'destructive.bat')
        .expect(400);

      expect(res.body.message).toContain('Invalid file');
    });

    it('should accept files with allowed extensions (.png)', async () => {
      const pngContent = Buffer.from('fake png content');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', pngContent, 'image.png')
        .expect(201);

      expect(res.body.fileName).toBe('image.png');
    });

    it('should accept files with allowed extensions (.docx)', async () => {
      const docxContent = Buffer.from('fake docx content');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', docxContent, 'report.docx')
        .expect(201);

      expect(res.body.fileName).toBe('report.docx');
    });
  });

  describe('Filename validation', () => {
    it('should reject filenames with path traversal (..)', async () => {
      const content = Buffer.from('test content');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', content, '../../../etc/passwd.txt')
        .expect(400);

      expect(res.body.message).toContain('Invalid filename');
    });

    it('should reject filenames with forward slashes', async () => {
      const content = Buffer.from('test content');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', content, 'path/to/file.txt')
        .expect(400);

      expect(res.body.message).toContain('Invalid filename');
    });

    it('should reject filenames with backslashes', async () => {
      const content = Buffer.from('test content');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', content, 'path\\to\\file.txt')
        .expect(400);

      expect(res.body.message).toContain('Invalid filename');
    });

    it('should accept normal filenames', async () => {
      const content = Buffer.from('test content');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', content, 'normal-file.txt')
        .expect(201);

      expect(res.body.fileName).toBe('normal-file.txt');
    });

    it('should accept filenames with spaces', async () => {
      const content = Buffer.from('test content');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', content, 'my evidence file.txt')
        .expect(201);

      expect(res.body.fileName).toBe('my evidence file.txt');
    });
  });

  describe('Multiple file rejection', () => {
    it('should reject multiple file uploads', async () => {
      const file1 = Buffer.from('first file');
      const file2 = Buffer.from('second file');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', file1, 'file1.txt')
        .attach('file', file2, 'file2.txt')
        .expect(400);

      expect(res.body.message).toContain('Only one file');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty file content', async () => {
      const emptyContent = Buffer.alloc(0);

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', emptyContent, 'empty.txt')
        .expect(201);

      expect(res.body.fileName).toBe('empty.txt');
    });

    it('should handle Unicode filenames', async () => {
      const content = Buffer.from('test content');

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', content, '证据文件.txt')
        .expect(201);

      expect(res.body.fileName).toBe('证据文件.txt');
    });

    it('should handle very long but valid filenames', async () => {
      const content = Buffer.from('test content');
      const longFilename = 'a'.repeat(200) + '.txt';

      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', content, longFilename)
        .expect(201);

      expect(res.body.fileName).toBe(longFilename);
    });
  });
});
