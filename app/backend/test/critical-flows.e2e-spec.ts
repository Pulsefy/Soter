import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ONCHAIN_ADAPTER_TOKEN } from '../src/onchain/onchain.adapter';
import { VerificationChannel } from '@prisma/client';

describe('Critical Flows (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const mockOnchainAdapter = {
    getAidPackage: jest.fn().mockResolvedValue({
      package: {
        id: 'pkg_123',
        status: 'Created',
        amount: '1000',
        recipient: 'GABC...',
      },
      timestamp: new Date(),
    }),
    getTokenBalance: jest.fn().mockResolvedValue({ balance: '5000' }),
    createAidPackage: jest.fn().mockResolvedValue({ packageId: 'pkg_123', transactionHash: 'hash' }),
    getAidPackageCount: jest.fn().mockResolvedValue({
      aggregates: {
        totalCommitted: '5000',
        totalClaimed: '2000',
        totalExpiredCancelled: '500',
      },
      timestamp: new Date(),
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ONCHAIN_ADAPTER_TOKEN)
      .useValue(mockOnchainAdapter)
      .compile();

    app = moduleFixture.createNestApplication();

    // Replicate production configuration from main.ts
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'v',
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Cleanup any created data
    await prisma.verificationSession.deleteMany({
      where: { identifier: 'e2e@pulsefy.io' },
    });
    await app.close();
  });

  describe('1. Health and Readiness', () => {
    it('should return 200 for liveness check', () => {
      return request(app.getHttpServer())
        .get('/api/v1/health/live')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
        });
    });

    it('should return 200 for readiness check', () => {
      return request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(200)
        .expect((res) => {
          expect(res.body.ready).toBeDefined();
        });
    });
  });

  describe('2. Verification Flow', () => {
    let sessionId: string;
    const testEmail = 'e2e@pulsefy.io';

    it('should start a verification session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .send({
          channel: VerificationChannel.email,
          email: testEmail,
        })
        .expect(200);

      expect(res.body.sessionId).toBeDefined();
      expect(res.body.channel).toBe('email');
      sessionId = res.body.sessionId;
    });

    it('should complete verification with valid code', async () => {
      // Get code from DB for e2e test bypass
      const session = await prisma.verificationSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new Error('Session not found in DB');
      }

      const res = await request(app.getHttpServer())
        .post('/api/v1/verification/complete')
        .send({
          sessionId,
          code: session.code,
        })
        .expect(200);

      expect(res.body.verified).toBe(true);
    });
  });

  describe('3. On-chain Proxy (Soroban)', () => {
    it('should retrieve aid package details via proxy', async () => {
      const packageId = 'pkg_123';
      const res = await request(app.getHttpServer())
        .get(`/api/v1/onchain/aid-escrow/packages/${packageId}`)
        .expect(200);

      expect(res.body.package.id).toBe(packageId);
      expect(mockOnchainAdapter.getAidPackage).toHaveBeenCalled();
    });

    it('should retrieve aid package statistics', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/onchain/aid-escrow/stats')
        .expect(200);

      expect(res.body.aggregates).toBeDefined();
      expect(mockOnchainAdapter.getAidPackageCount).toHaveBeenCalled();
    });
  });
});
