import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import request, { Response as SupertestResponse } from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { App } from 'supertest/types';
import { ConfigService } from '@nestjs/config';

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

type ClaimResponseDto = {
  id: string;
  status: string;
  campaignId: string;
  amount: number;
  recipientRef: string;
  evidenceRef?: string;
  campaign: {
    id: string;
    name: string;
  };
};

function bodyAs<T>(res: SupertestResponse): ApiResponse<T> {
  return res.body as ApiResponse<T>;
}

describe('Full Claim Flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mockHttpService: { post: jest.Mock };
  let mockQueue: { add: jest.Mock; getWaitingCount: jest.Mock; getActiveCount: jest.Mock; getCompletedCount: jest.Mock; getFailedCount: jest.Mock };
  let verificationService: VerificationService;

  const claimsBase = '/api/v1/claims';
  const verificationBase = '/api/v1/verification';

  beforeAll(async () => {
    // Set test environment variables
    process.env.ONCHAIN_ENABLED = 'true';
    process.env.ONCHAIN_ADAPTER = 'mock';
    process.env.VERIFICATION_MODE = 'ai'; // Use AI mode to trigger HTTP calls
    process.env.VERIFICATION_THRESHOLD = '0.7';
    process.env.AI_SERVICE_URL = 'http://localhost:8000';

    // Mock the AI service HTTP calls
    mockHttpService = {
      post: jest.fn(),
    };

    // Mock successful OCR response
    mockHttpService.post.mockReturnValue(
      of({
        data: {
          success: true,
          data: {
            fields: {
              name: { value: 'John Doe', confidence: 0.95 },
              date_of_birth: { value: '1990-01-01', confidence: 0.90 },
              id_number: { value: '123456789', confidence: 0.85 },
            },
            raw_text: 'Sample document text',
            processing_time_ms: 1500,
          },
          processing_time_ms: 1500,
        },
      }),
    );

    // Mock the verification queue
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      getWaitingCount: jest.fn().mockResolvedValue(0),
      getActiveCount: jest.fn().mockResolvedValue(0),
      getCompletedCount: jest.fn().mockResolvedValue(1),
      getFailedCount: jest.fn().mockResolvedValue(0),
    };

    const mockQueueFactory = () => mockQueue;

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          ONCHAIN_ENABLED: 'true',
          ONCHAIN_ADAPTER: 'mock',
          VERIFICATION_MODE: 'ai',
          VERIFICATION_THRESHOLD: '0.7',
          AI_SERVICE_URL: 'http://localhost:8000',
          REDIS_HOST: 'mock-redis', // Mock Redis host to avoid connection
          REDIS_PORT: '6379',
        };
        return config[key];
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HttpService)
      .useValue(mockHttpService)
      .overrideProvider(ConfigService)
      .useValue(mockConfigService)
      .overrideProvider(getQueueToken('verification'))
      .useFactory(mockQueueFactory)
      .overrideProvider(getQueueToken('notifications'))
      .useFactory(mockQueueFactory)
      .overrideProvider(getQueueToken('onchain'))
      .useFactory(mockQueueFactory)
      .compile();

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
    verificationService = app.get(VerificationService);

    // Ensure API key exists for testing
    await prisma.apiKey.upsert({
      where: { key: 'dev-admin-key-000' },
      update: { role: AppRole.admin, description: 'Test admin key' },
      create: { key: 'dev-admin-key-000', role: AppRole.admin, description: 'Test admin key' },
    });
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.claim.deleteMany();
    await prisma.campaign.deleteMany();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Complete Claim Lifecycle', () => {
    it('should process full claim flow: create -> verify -> approve -> disburse', async () => {
      // Step 1: Create a campaign
      const campaign = await prisma.campaign.create({
        data: {
          name: 'Test Humanitarian Campaign',
          budget: 10000,
          status: 'active',
        },
      });

      // Step 2: Create a claim
      const createClaimRes = await request(app.getHttpServer())
        .post(claimsBase)
        .set('x-api-key', 'dev-admin-key-000')
        .send({
          campaignId: campaign.id,
          amount: 500.00,
          recipientRef: 'GAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', // Mock Stellar address
          evidenceRef: 'https://example.com/document.jpg',
        })
        .expect(201);

      const claimBody = bodyAs<ClaimResponseDto>(createClaimRes);
      expect(claimBody.success).toBe(true);
      expect(claimBody.data.status).toBe('requested');
      expect(claimBody.data.amount).toBe(500);
      expect(claimBody.data.campaignId).toBe(campaign.id);

      const claimId = claimBody.data.id;

      // Verify claim was created in database
      const createdClaim = await prisma.claim.findUnique({
        where: { id: claimId },
        include: { campaign: true },
      });
      expect(createdClaim).toBeTruthy();
      expect(createdClaim!.status).toBe('requested');

      // Check initial audit log
      const initialAuditLogs = await prisma.auditLog.findMany({
        where: { entity: 'claim', entityId: claimId },
      });
      expect(initialAuditLogs).toHaveLength(1);
      expect(initialAuditLogs[0].action).toBe('created');

      // Step 3: Enqueue verification
      const enqueueRes = await request(app.getHttpServer())
        .post(`${verificationBase}/claims/${claimId}/enqueue`)
        .set('x-api-key', 'dev-admin-key-000')
        .expect(202);

      expect(enqueueRes.body.jobId).toBeDefined();
      expect(enqueueRes.body.claimId).toBe(claimId);
      expect(enqueueRes.body.status).toBe('queued');

      // Check verification enqueue audit log
      const enqueueAuditLogs = await prisma.auditLog.findMany({
        where: {
          entity: 'verification',
          entityId: claimId,
          action: 'enqueue',
        },
      });
      expect(enqueueAuditLogs).toHaveLength(1);

      // Manually process the verification job for deterministic testing
      await verificationService.processVerification({
        claimId,
        timestamp: Date.now(),
      });

      // Check if claim status was updated to verified
      const verifiedClaim = await prisma.claim.findUnique({
        where: { id: claimId },
      });
      expect(verifiedClaim!.status).toBe('verified');

      // Check verification complete audit log
      const verificationAuditLogs = await prisma.auditLog.findMany({
        where: {
          entity: 'verification',
          entityId: claimId,
          action: 'complete',
        },
      });
      expect(verificationAuditLogs).toHaveLength(1);
      expect(verificationAuditLogs[0].metadata).toHaveProperty('score');
      expect(verificationAuditLogs[0].metadata.score).toBeGreaterThanOrEqual(0.7); // threshold

      // Step 4: Approve the claim (requires admin role, but for testing we'll assume auth is bypassed)
      // Note: In real scenario, this would require authentication
      const approveRes = await request(app.getHttpServer())
        .post(`${claimsBase}/${claimId}/approve`)
        .set('x-api-key', 'dev-admin-key-000')
        .expect(200);

      const approvedClaim = await prisma.claim.findUnique({
        where: { id: claimId },
      });
      expect(approvedClaim!.status).toBe('approved');

      // Step 5: Disburse the claim
      const disburseRes = await request(app.getHttpServer())
        .post(`${claimsBase}/${claimId}/disburse`)
        .set('x-api-key', 'dev-admin-key-000')
        .expect(200);

      // Verify final claim status
      const disbursedClaim = await prisma.claim.findUnique({
        where: { id: claimId },
      });
      expect(disbursedClaim!.status).toBe('disbursed');

      // Check onchain disburse audit log
      const disburseAuditLogs = await prisma.auditLog.findMany({
        where: {
          entity: 'onchain',
          entityId: claimId,
          action: 'disburse',
        },
      });
      expect(disburseAuditLogs).toHaveLength(1);
      expect(disburseAuditLogs[0].metadata).toHaveProperty('transactionHash');
      expect(disburseAuditLogs[0].metadata).toHaveProperty('status', 'success');

      // Verify all audit logs are present
      const allAuditLogs = await prisma.auditLog.findMany({
        where: { entityId: claimId },
        orderBy: { timestamp: 'asc' },
      });

      const expectedActions = [
        'created',
        'status_changed_to_verified',
        'status_changed_to_approved',
        'status_changed_to_disbursed',
      ];

      // Filter for claim entity actions
      const claimActions = allAuditLogs
        .filter(log => log.entity === 'claim')
        .map(log => log.action);

      expectedActions.forEach(action => {
        expect(claimActions).toContain(action);
      });

      // Verify AI service was called
      expect(mockHttpService.post).toHaveBeenCalledWith(
        expect.stringContaining('/ai/ocr'),
        expect.objectContaining({
          document_url: 'https://example.com/document.jpg',
        }),
        expect.any(Object),
      );
    });

    it('should handle verification failure and not approve claim', async () => {
      // Mock failed OCR response
      mockHttpService.post.mockReturnValueOnce(
        of({
          data: {
            success: false,
            error: { message: 'OCR processing failed' },
          },
        }),
      );

      // Create campaign and claim
      const campaign = await prisma.campaign.create({
        data: {
          name: 'Test Campaign',
          budget: 1000,
          status: 'active',
        },
      });

      const createClaimRes = await request(app.getHttpServer())
        .post(claimsBase)
        .set('x-api-key', 'dev-admin-key-000')
        .send({
          campaignId: campaign.id,
          amount: 100.00,
          recipientRef: 'GAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          evidenceRef: 'https://example.com/document.jpg',
        })
        .expect(201);

      const claimId = bodyAs<ClaimResponseDto>(createClaimRes).data.id;

      // Enqueue verification
      await request(app.getHttpServer())
        .post(`${verificationBase}/claims/${claimId}/enqueue`)
        .set('x-api-key', 'dev-admin-key-000')
        .expect(202);

      // Manually process the verification job
      await verificationService.processVerification({
        claimId,
        timestamp: Date.now(),
      });

      // Claim should remain in requested status due to failed verification
      const claim = await prisma.claim.findUnique({
        where: { id: claimId },
      });
      expect(claim!.status).toBe('requested');
    });
  });
});