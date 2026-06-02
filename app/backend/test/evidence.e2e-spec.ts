import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EvidenceStatus } from '@prisma/client';
import { App } from 'supertest/types';
import { MAX_FILE_SIZE } from 'src/evidence/file-validation';

describe('Evidence Queue (e2e)', () => {
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

  it('POST /evidence/upload queues a file and encrypts it', async () => {
    const fileContent = Buffer.from('test evidence content');
    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'test.txt')
      .expect(201);

    expect(res.body.fileName).toBe('test.txt');
    expect(res.body.status).toBe(EvidenceStatus.pending);

    // Verify file exists on disk and is NOT plain text
    const item = await prisma.evidenceQueueItem.findUnique({
      where: { id: res.body.id },
    });
    expect(item?.filePath).toBeDefined();

    const savedContent = await fs.readFile(item!.filePath!);
    expect(savedContent.toString()).not.toContain('test evidence content');
  });

  it('POST /evidence/upload prevents exact duplicates within org scope', async () => {
    const fileContent = Buffer.from('unique content');
    const orgId = 'org-123';

    await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'test1.txt')
      .set('x-org-id', orgId)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'test2.txt')
      .set('x-org-id', orgId)
      .expect(400);

    expect(res.body.message).toContain(
      'already exists in queue for this organization',
    );
  });

  it('POST /evidence/upload allows same file in different organizations (tenant isolation)', async () => {
    const fileContent = Buffer.from('shared content');
    const org1Id = 'org-1';
    const org2Id = 'org-2';

    const res1 = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'test1.txt')
      .set('x-org-id', org1Id)
      .expect(201);

    const res2 = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'test2.txt')
      .set('x-org-id', org2Id)
      .expect(201);

    expect(res1.body.id).not.toBe(res2.body.id);
    expect(res1.body.orgId).toBe(org1Id);
    expect(res2.body.orgId).toBe(org2Id);
  });

  it('POST /evidence/upload stores fingerprint for near-duplicate detection', async () => {
    const fileContent = Buffer.from('fingerprint test content');

    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'test.txt')
      .expect(201);

    const item = await prisma.evidenceQueueItem.findUnique({
      where: { id: res.body.id },
    });

    expect(item?.fingerprint).toBeDefined();
    expect(item?.fingerprint).toHaveLength(64);
  });

  it('POST /evidence/upload creates near-duplicate reference when fingerprint matches', async () => {
    const fileContent = Buffer.from('near duplicate test');
    const orgId = 'org-456';

    // Upload original
    const originalRes = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'original.txt')
      .set('x-org-id', orgId)
      .expect(201);

    // Upload near-duplicate (same content, different filename)
    const duplicateRes = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'duplicate.txt')
      .set('x-org-id', orgId)
      .expect(201);

    expect(duplicateRes.body.nearDuplicateOf).toBe(originalRes.body.id);
    expect(duplicateRes.body.status).toBe(EvidenceStatus.completed);
    expect(duplicateRes.body.filePath).toBeNull(); // No file stored for near-duplicate
  });

  it('GET /evidence/queue lists items', async () => {
    const fileContent = Buffer.from('some content');
    await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'test.txt');

    const res = await request(app.getHttpServer())
      .get('/api/v1/evidence/queue')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].fileName).toBe('test.txt');
  });

  it('DELETE /evidence/queue/:id removes item and file', async () => {
    const fileContent = Buffer.from('content to delete');
    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'delete-me.txt');

    const itemId = uploadRes.body.id;
    const itemBefore = await prisma.evidenceQueueItem.findUnique({
      where: { id: itemId },
    });
    const filePath = itemBefore!.filePath!;

    await request(app.getHttpServer())
      .delete(`/api/v1/evidence/queue/${itemId}`)
      .expect(200);

    // Verify DB record is gone
    const itemAfter = await prisma.evidenceQueueItem.findUnique({
      where: { id: itemId },
    });
    expect(itemAfter).toBeNull();

    // Verify file is gone
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('POST /evidence/upload rejects invalid MIME type', async () => {
    const fileContent = Buffer.from('fake image content');

    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, {
        filename: 'test.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(400);

    expect(res.body.message).toContain('Invalid MIME type');
  });

  it('POST /evidence/upload rejects a disallowed file extension', async () => {
    const fileContent = Buffer.from('totally text but wrong extension');

    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, {
        filename: 'malware.exe',
        contentType: 'text/plain',
      })
      .expect(400);

    expect(res.body.message).toContain('extension');
  });

  it('POST /evidence/upload rejects an unsafe (path-traversal) filename', async () => {
    const fileContent = Buffer.from('escape attempt');

    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, {
        filename: '../../evil.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    expect(res.body.message).toContain('filename');
  });

  it('POST /evidence/upload rejects content that does not match its declared type', async () => {
    // Declared as a PNG but the bytes are plain text — magic-byte sniffing
    // must reject it.
    const fileContent = Buffer.from('this is not really a png image');

    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);

    expect(res.body.message).toMatch(/do not match/i);
  });

  it('POST /evidence/upload rejects an empty file', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', Buffer.alloc(0), {
        filename: 'empty.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    expect(res.body.message).toMatch(/empty/i);
  });

  it('POST /evidence/upload rejects more than one file', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', Buffer.from('first'), {
        filename: 'a.txt',
        contentType: 'text/plain',
      })
      .attach('file', Buffer.from('second'), {
        filename: 'b.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    expect(res.body.message).toMatch(/single file/i);
  });

  it('POST /evidence/upload rejects a request with no file', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .field('note', 'no file attached')
      .expect(400);

    expect(res.body.message).toContain('No file uploaded');
  });

  it('POST /evidence/upload accepts a file exactly at the size limit', async () => {
    // 'a' repeated up to the limit sniffs as text/plain.
    const atLimit = Buffer.alloc(MAX_FILE_SIZE, 0x61);

    await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', atLimit, {
        filename: 'at-limit.txt',
        contentType: 'text/plain',
      })
      .expect(201);
  });

  it('POST /evidence/upload rejects oversized files with 413', async () => {
    const largeFile = Buffer.alloc(MAX_FILE_SIZE + 1024, 'a');

    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', largeFile, {
        filename: 'big.txt',
        contentType: 'text/plain',
      })
      .expect(413);

    expect(res.body.message).toContain('File too large');
  });

  it('POST /evidence/upload stores correct hash for integrity', async () => {
    const fileContent = Buffer.from('hash check content');

    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, {
        filename: 'hash-test.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    const item = await prisma.evidenceQueueItem.findUnique({
      where: { id: res.body.id },
    });

    expect(item?.fileHash).toBeDefined();
    expect(item?.fileHash).toHaveLength(64);
  });

  it('Near-duplicate detection preserves auditability with metadata', async () => {
    const fileContent = Buffer.from('audit test content');
    const orgId = 'org-789';

    const originalRes = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'original.txt')
      .set('x-org-id', orgId)
      .expect(201);

    const duplicateRes = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'duplicate.txt')
      .set('x-org-id', orgId)
      .expect(201);

    const duplicateItem = await prisma.evidenceQueueItem.findUnique({
      where: { id: duplicateRes.body.id },
    });

    expect(duplicateItem?.metadata).toBeDefined();
    expect(duplicateItem?.metadata?.isNearDuplicate).toBe(true);
    expect(duplicateItem?.metadata?.originalId).toBe(originalRes.body.id);
  });
});
