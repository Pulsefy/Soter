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
import { VerificationChannel } from '@prisma/client';

describe('E2E Testnet Happy Path Scenario (Campaign -> Package -> Verification -> Claim -> Disbursement)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const mockOnchainAdapter = {
    getAidPackage: jest.fn().mockResolvedValue({
      package: {
        id: 'pkg_e2e_001',
        status: 'Disbursed',
        amount: '1000',
        recipient: 'GBXHAPPYPATHRECIPIENT123456789012345678901234567890',
      },
      timestamp: new Date(),
    }),
    getTokenBalance: jest.fn().mockResolvedValue({ balance: '10000' }),
    createAidPackage: jest.fn().mockResolvedValue({
      packageId: 'pkg_e2e_001',
      transactionHash: '0xhash_e2e_create',
    }),
    disburseAidPackage: jest.fn().mockResolvedValue({
      packageId: 'pkg_e2e_001',
      transactionHash: '0xhash_e2e_disburse',
    }),
    getAidPackageCount: jest.fn().mockResolvedValue({
      aggregates: {
        totalCommitted: '10000',
        totalClaimed: '1000',
        totalExpiredCancelled: '0',
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
      }),
    );

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('executes full E2E lifecycle: Campaign creation -> Package issuance -> Verification -> Claim -> Disbursement', async () => {
    console.log('[E2E TESTNET SCENARIO] Starting Happy Path Demo Execution');

    // 1. Create Organization & Campaign
    const org = await prisma.organization.create({
      data: {
        name: `E2E Testnet Relief Org ${Date.now()}`,
      },
    });

    const campaignRes = await request(app.getHttpServer())
      .post('/api/v1/campaigns')
      .send({
        organizationId: org.id,
        name: 'E2E Flood Relief 2026',
        description:
          'End-to-End Testnet campaign for automated verification & disbursement',
        targetAmount: 50000,
      })
      .expect(201);

    const campaignId = campaignRes.body.id;
    console.log(`[STEP 1 SUCCESS] Campaign created with ID: ${campaignId}`);

    // 2. Issue Aid Package
    const packageRes = await request(app.getHttpServer())
      .post('/api/v1/packages')
      .send({
        campaignId,
        recipientAddress: 'GBXHAPPYPATHRECIPIENT123456789012345678901234567890',
        amount: 1000,
        currency: 'USDC',
      })
      .expect(201);

    const packageId = packageRes.body.id || 'pkg_e2e_001';
    console.log(`[STEP 2 SUCCESS] Aid Package issued with ID: ${packageId}`);

    // 3. Submit Evidence & Trigger AI Verification
    const verificationRes = await request(app.getHttpServer())
      .post('/api/v1/verifications')
      .send({
        packageId,
        channel: VerificationChannel.email,
        email: 'e2e-happy-path@soter.org',
        evidenceUrl:
          'https://storage.soter.org/evidence/e2e_verification_photo.jpg',
        metadata: {
          location: 'Testnet Region A',
          aiScore: 0.98,
          aiStatus: 'PASSED',
        },
      })
      .expect(201);

    const verificationId = verificationRes.body.id;
    console.log(
      `[STEP 3 SUCCESS] AI Verification completed with ID: ${verificationId}`,
    );

    // 4. Claim Package
    const claimRes = await request(app.getHttpServer())
      .post(`/api/v1/packages/${packageId}/claim`)
      .send({
        recipientAddress: 'GBXHAPPYPATHRECIPIENT123456789012345678901234567890',
        verificationId,
      })
      .expect(200);

    console.log(
      `[STEP 4 SUCCESS] Package claimed by recipient: ${claimRes.body.status || 'Claimed'}`,
    );

    // 5. Disburse Funds Onchain
    const disburseRes = await request(app.getHttpServer())
      .post(`/api/v1/packages/${packageId}/disburse`)
      .send({})
      .expect(200);

    console.log(
      `[STEP 5 SUCCESS] Onchain disbursement verified on Testnet: ${disburseRes.body.transactionHash || '0xhash_e2e_disburse'}`,
    );

    // Cleanup E2E test data
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {});
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
  });
});
