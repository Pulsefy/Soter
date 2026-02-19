import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { VerificationChannel } from '@prisma/client';

describe('Verification flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const base = '/api/v1/verification';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'v',
    });

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
    try {
      await prisma.verificationSession.deleteMany();
    } catch (err: unknown) {
      const message =
        err && typeof (err as { message?: string }).message === 'string'
          ? (err as { message: string }).message
          : '';
      if (
        message.includes('VerificationSession') &&
        message.includes('does not exist')
      ) {
        throw new Error(
          'VerificationSession table missing. Run: npx prisma migrate dev',
        );
      }
      throw err;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /verification/start', () => {
    it('should start verification and return sessionId (email)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${base}/start`)
        .send({ channel: 'email', email: 'user@example.com' })
        .expect(200);

      expect(res.body).toMatchObject({
        sessionId: expect.any(String),
        channel: 'email',
        expiresAt: expect.any(String),
        message: expect.any(String),
      });
      expect(res.body.sessionId.length).toBeGreaterThan(0);
    });

    it('should start verification for phone', async () => {
      const res = await request(app.getHttpServer())
        .post(`${base}/start`)
        .send({ channel: 'phone', phone: '+15551234567' })
        .expect(200);

      expect(res.body.channel).toBe('phone');
      expect(res.body.sessionId).toBeDefined();
    });

    it('should reject missing email when channel is email', async () => {
      await request(app.getHttpServer())
        .post(`${base}/start`)
        .send({ channel: 'email' })
        .expect(400);
    });

    it('should reject missing phone when channel is phone', async () => {
      await request(app.getHttpServer())
        .post(`${base}/start`)
        .send({ channel: 'phone' })
        .expect(400);
    });

    it('should reject invalid channel', async () => {
      await request(app.getHttpServer())
        .post(`${base}/start`)
        .send({ channel: 'sms', email: 'a@b.com' })
        .expect(400);
    });
  });

  describe('Successful flow: start -> complete', () => {
    it('should complete verification with correct code', async () => {
      const session = await prisma.verificationSession.create({
        data: {
          channel: VerificationChannel.email,
          identifier: 'flow@example.com',
          code: '123456',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      const completeRes = await request(app.getHttpServer())
        .post(`${base}/complete`)
        .send({ sessionId: session.id, code: '123456' })
        .expect(200);

      expect(completeRes.body).toMatchObject({
        sessionId: session.id,
        verified: true,
        message: 'Verification completed successfully.',
      });

      const updated = await prisma.verificationSession.findUnique({
        where: { id: session.id },
      });
      expect(updated?.status).toBe('completed');
    });
  });

  describe('POST /verification/complete', () => {
    it('should return 400 for wrong code', async () => {
      const session = await prisma.verificationSession.create({
        data: {
          channel: VerificationChannel.email,
          identifier: 'wrong@example.com',
          code: '123456',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      await request(app.getHttpServer())
        .post(`${base}/complete`)
        .send({ sessionId: session.id, code: '999999' })
        .expect(400);
    });

    it('should return 404 for unknown sessionId', async () => {
      await request(app.getHttpServer())
        .post(`${base}/complete`)
        .send({
          sessionId: 'clv000000000000000000000',
          code: '123456',
        })
        .expect(404);
    });

    it('should reject invalid code format (non-digits)', async () => {
      const session = await prisma.verificationSession.create({
        data: {
          channel: VerificationChannel.email,
          identifier: 'x@y.com',
          code: '123456',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      await request(app.getHttpServer())
        .post(`${base}/complete`)
        .send({ sessionId: session.id, code: '12ab56' })
        .expect(400);
    });

    it('should reject code that is too short', async () => {
      const session = await prisma.verificationSession.create({
        data: {
          channel: VerificationChannel.email,
          identifier: 'x@y.com',
          code: '123456',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      await request(app.getHttpServer())
        .post(`${base}/complete`)
        .send({ sessionId: session.id, code: '123' })
        .expect(400);
    });
  });

  describe('POST /verification/resend', () => {
    it('should resend and allow complete with new code', async () => {
      const session = await prisma.verificationSession.create({
        data: {
          channel: VerificationChannel.email,
          identifier: 'resend@example.com',
          code: '111111',
          resendCount: 0,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      const resendRes = await request(app.getHttpServer())
        .post(`${base}/resend`)
        .send({ sessionId: session.id })
        .expect(200);

      expect(resendRes.body.sessionId).toBe(session.id);
      expect(resendRes.body.expiresAt).toBeDefined();

      const updated = await prisma.verificationSession.findUnique({
        where: { id: session.id },
      });
      expect(updated?.resendCount).toBe(1);
      expect(updated?.code).not.toBe('111111');

      await request(app.getHttpServer())
        .post(`${base}/complete`)
        .send({ sessionId: session.id, code: updated!.code })
        .expect(200);
    });

    it('should return 404 for unknown sessionId', async () => {
      await request(app.getHttpServer())
        .post(`${base}/resend`)
        .send({ sessionId: 'clv000000000000000000000' })
        .expect(404);
    });

    it('should return 400 when resend limit exceeded', async () => {
      const session = await prisma.verificationSession.create({
        data: {
          channel: VerificationChannel.email,
          identifier: 'limit@example.com',
          code: '123456',
          resendCount: 3,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      await request(app.getHttpServer())
        .post(`${base}/resend`)
        .send({ sessionId: session.id })
        .expect(400);
    });
  });
});
