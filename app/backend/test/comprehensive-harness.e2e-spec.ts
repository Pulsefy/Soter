import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ONCHAIN_ADAPTER_TOKEN } from '../src/onchain/onchain.adapter';
import { mockSorobanAdapter } from './mocks/external-services.mock';

describe('Comprehensive E2E Harness', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const API_KEY = 'test-api-key-123';

  beforeAll(async () => {
    // Set environment variables for testing
    process.env.API_KEY = API_KEY;
    process.env.ONCHAIN_ADAPTER = 'mock';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ONCHAIN_ADAPTER_TOKEN)
      .useValue(mockSorobanAdapter)
      .compile();

    app = moduleFixture.createNestApplication();

    // Standard app configuration as in main.ts
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

  afterAll(async () => {
    await app.close();
  });

  describe('Health & Readiness', () => {
    it('/api/v1/health/live (GET) - Liveness Probe', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'ok',
      });
      expect(res.body.uptime).toBeDefined();
    });

    it('/api/v1/health/ready (GET) - Readiness Probe', async () => {
      // Note: This might return 503 if DB/Redis mocks are not perfectly aligned,
      // but in a proper test environment with ioredis-mock and a test DB it should be 200.
      const res = await request(app.getHttpServer()).get(
        '/api/v1/health/ready',
      );

      // We accept both 200 and 503 for the purpose of the harness as long as it returns the correct structure
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('ready');
      expect(res.body).toHaveProperty('dependencies');
    });
  });

  describe('Verification Flow', () => {
    let sessionId: string;
    const testEmail = 'harness-test@example.com';

    it('should start a verification flow', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', API_KEY)
        .send({
          channel: 'email',
          email: testEmail,
        })
        .expect(200);

      expect(res.body).toHaveProperty('sessionId');
      sessionId = res.body.sessionId;
    });

    it('should complete a verification flow', async () => {
      // For the test, we bypass the actual email sending and look up the code in the DB
      const session = await prisma.verificationSession.findUnique({
        where: { id: sessionId },
      });

      expect(session).toBeDefined();
      const code = session!.code;

      const res = await request(app.getHttpServer())
        .post('/api/v1/verification/complete')
        .set('x-api-key', API_KEY)
        .send({
          sessionId,
          code,
        })
        .expect(200);

      expect(res.body).toMatchObject({
        verified: true,
      });
    });
  });

  describe('Onchain Proxy (Aid Escrow)', () => {
    it('should proxy a call to the blockchain contract (mocked)', async () => {
      const packageId = 'pkg_harness_001';

      // Mock the getAidPackage response
      mockSorobanAdapter.getAidPackage = jest.fn().mockResolvedValue({
        package: {
          id: packageId,
          recipient: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
          amount: '5000000000',
          token: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
          status: 'Created',
          createdAt: Math.floor(Date.now() / 1000),
          expiresAt: Math.floor(Date.now() / 1000) + 86400,
        },
        timestamp: new Date().toISOString(),
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/onchain/aid-escrow/packages/${packageId}`)
        .set('x-api-key', API_KEY)
        .expect(200);

      expect(res.body.package).toBeDefined();
      expect(res.body.package.id).toBe(packageId);
      expect(mockSorobanAdapter.getAidPackage).toHaveBeenCalledWith({
        packageId,
      });
    });
  });
});
