import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { App } from 'supertest/types';

describe('Internal Notes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.internalNote.deleteMany();
    await prisma.claim.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.verificationSession.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Claims Notes', () => {
    it('POST /claims/:id/notes adds a note', async () => {
      const campaign = await prisma.campaign.create({
        data: { name: 'Test Campaign', budget: 1000 },
      });

      const claim = await prisma.claim.create({
        data: {
          campaignId: campaign.id,
          amount: 50,
          recipientRef: 'recipient-1',
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/claims/${claim.id}/notes`)
        .send({
          content: 'This is an internal note.',
          category: 'investigation',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('This is an internal note.');
      expect(res.body.data.category).toBe('investigation');
      expect(res.body.data.entityType).toBe('claim');
      expect(res.body.data.entityId).toBe(claim.id);

      const notes = await prisma.internalNote.findMany({
        where: { entityId: claim.id },
      });
      expect(notes).toHaveLength(1);
    });

    it('GET /claims/:id/notes lists notes', async () => {
      const campaign = await prisma.campaign.create({
        data: { name: 'Test Campaign', budget: 1000 },
      });

      const claim = await prisma.claim.create({
        data: {
          campaignId: campaign.id,
          amount: 50,
          recipientRef: 'recipient-1',
        },
      });

      await prisma.internalNote.create({
        data: {
          entityType: 'claim',
          entityId: claim.id,
          content: 'Note 1',
          authorId: 'test-author',
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/claims/${claim.id}/notes`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].content).toBe('Note 1');
    });
  });

  describe('Verification Notes', () => {
    it('POST /verification/:id/notes adds a note', async () => {
      const session = await prisma.verificationSession.create({
        data: {
          identifier: 'test@example.com',
          channel: 'email',
          otpHash: 'hash',
          expiresAt: new Date(Date.now() + 3600000),
          status: 'pending',
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/verification/${session.id}/notes`)
        .send({
          content: 'Verification note.',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('Verification note.');
      expect(res.body.data.entityType).toBe('verification');
      expect(res.body.data.entityId).toBe(session.id);
    });
  });
});
