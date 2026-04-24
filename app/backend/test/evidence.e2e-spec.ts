import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EvidenceStatus } from '@prisma/client';
import { App } from 'supertest/types';

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

  it('POST /evidence/upload prevents duplicates', async () => {
    const fileContent = Buffer.from('unique content');

    await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'test1.txt')
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/evidence/upload')
      .attach('file', fileContent, 'test2.txt')
      .expect(400);

    expect(res.body.message).toBe('File already exists in queue');
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
});
