import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { VerificationMetadataService } from '../src/verification/metadata.service';
import { ClaimStatus, CampaignStatus } from '@prisma/client';

describe('Verification Metadata E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let metadataService: VerificationMetadataService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    metadataService = moduleFixture.get<VerificationMetadataService>(
      VerificationMetadataService,
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Metadata Generation', () => {
    it('should generate contract-aware metadata for a claim', async () => {
      const campaignId = '123e4567-e89b-12d3-a456-426614174000';
      const claimId = '123e4567-e89b-12d3-a456-426614174001';

      // Mock claim in database - using proper Prisma enums and required fields
      await prisma.campaign.create({
        data: {
          id: campaignId,
          name: 'Test Campaign',
          status: CampaignStatus.active,
          budget: 10000, // Required field
          organization: {
            connect: { id: 'org_123' },
          },
        },
      });

      await prisma.claim.create({
        data: {
          id: claimId,
          campaignId,
          status: ClaimStatus.requested,
          amount: 100,
          recipientRef: 'recipient_123',
          // packageId removed - if it doesn't exist in the schema
          // If you need packageId, add it to the Claim model in schema.prisma
        },
      });

      const metadata = await metadataService.generateMetadata(
        claimId,
        campaignId,
      );

      expect(metadata).toBeDefined();
      expect(metadata.campaignId).toBe(campaignId);
      expect(metadata.claimId).toBe(claimId);
      expect(metadata.packageId).toBeDefined();
      expect(metadata.network).toBeDefined();
      expect(metadata.timestamp).toBeDefined();
    });

    it('should validate metadata correctly', () => {
      const validMetadata = {
        campaignId: '123e4567-e89b-12d3-a456-426614174000',
        claimId: '123e4567-e89b-12d3-a456-426614174001',
        packageId: 'pkg_abc123',
        network: 'testnet',
      };

      const errors = metadataService.validateMetadata(validMetadata);
      expect(errors).toHaveLength(0);

      const invalidMetadata = {
        campaignId: 'invalid-uuid',
        claimId: 'invalid-uuid',
        packageId: '',
        network: 'invalid',
      };

      const invalidErrors = metadataService.validateMetadata(invalidMetadata);
      expect(invalidErrors.length).toBeGreaterThan(0);
      expect(invalidErrors.some(e => e.includes('campaignId'))).toBe(true);
      expect(invalidErrors.some(e => e.includes('claimId'))).toBe(true);
      expect(invalidErrors.some(e => e.includes('packageId'))).toBe(true);
    });
  });

  describe('Webhook Payload Validation', () => {
    it('should validate webhook payload with correct metadata', () => {
      const validPayload = {
        claimId: '123e4567-e89b-12d3-a456-426614174001',
        campaignId: '123e4567-e89b-12d3-a456-426614174000',
        packageId: 'pkg_abc123',
        result: {
          score: 0.85,
          confidence: 0.92,
          details: {
            factors: ['Test factor'],
            riskLevel: 'low',
          },
        },
      };

      const { isValid, errors } =
        metadataService.validateWebhookPayload(validPayload);
      expect(isValid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it('should reject webhook payload with missing required fields', () => {
      const invalidPayload = {
        claimId: '123e4567-e89b-12d3-a456-426614174001',
        // Missing campaignId and packageId
        result: {
          score: 0.85,
          confidence: 0.92,
        },
      };

      const { isValid, errors } =
        metadataService.validateWebhookPayload(invalidPayload);
      expect(isValid).toBe(false);
      expect(errors).toContain('Missing required field: campaignId');
      expect(errors).toContain('Missing required field: packageId');
    });

    it('should reject webhook payload with invalid UUIDs', () => {
      const invalidPayload = {
        claimId: 'invalid-uuid',
        campaignId: 'invalid-uuid',
        packageId: 'pkg_abc123',
        result: {
          score: 0.85,
          confidence: 0.92,
        },
      };

      const { isValid, errors } =
        metadataService.validateWebhookPayload(invalidPayload);
      expect(isValid).toBe(false);
      expect(errors.some(e => e.includes('claimId'))).toBe(true);
      expect(errors.some(e => e.includes('campaignId'))).toBe(true);
    });
  });

  describe('Metadata Enhancement', () => {
    it('should enhance verification result with metadata', async () => {
      const result = {
        score: 0.85,
        confidence: 0.92,
        details: {
          factors: ['Test factor'],
          riskLevel: 'low' as const,
        },
        processedAt: new Date(),
      };

      const claimId = '123e4567-e89b-12d3-a456-426614174001';
      const campaignId = '123e4567-e89b-12d3-a456-426614174000';

      const enhanced = await metadataService.enhanceWithMetadata(
        result,
        claimId,
        campaignId,
      );

      expect(enhanced).toBeDefined();
      expect(enhanced.metadata).toBeDefined();
      expect(enhanced.metadata?.campaignId).toBe(campaignId);
      expect(enhanced.metadata?.claimId).toBe(claimId);
      expect(enhanced.metadata?.packageId).toBeDefined();
      expect(enhanced.score).toBe(0.85);
      expect(enhanced.confidence).toBe(0.92);
    });
  });

  describe('API Integration', () => {
    it('should include metadata in verification webhook', async () => {
      // First create the campaign and claim for the webhook test
      const campaignId = '223e4567-e89b-12d3-a456-426614174000';
      const claimId = '223e4567-e89b-12d3-a456-426614174001';

      await prisma.campaign
        .create({
          data: {
            id: campaignId,
            name: 'Test Campaign 2',
            status: CampaignStatus.active,
            budget: 10000, // Required field
            organization: {
              connect: { id: 'org_123' },
            },
          },
        })
        .catch(() => {}); // Ignore if already exists

      await prisma.claim
        .create({
          data: {
            id: claimId,
            campaignId,
            status: ClaimStatus.requested,
            amount: 100,
            recipientRef: 'recipient_456',
            // packageId removed
          },
        })
        .catch(() => {}); // Ignore if already exists

      const payload = {
        claimId: claimId,
        campaignId: campaignId,
        packageId: 'pkg_test456',
        network: 'testnet',
        result: {
          score: 0.85,
          confidence: 0.92,
          details: {
            factors: ['All criteria met'],
            riskLevel: 'low',
          },
        },
      };

      const response = await request(app.getHttpServer())
        .post('/webhooks/verification')
        .send(payload)
        .expect(201);

      expect(response.body).toBeDefined();
      expect(response.body.metadata).toBeDefined();
      expect(response.body.metadata.campaignId).toBe(payload.campaignId);
      expect(response.body.metadata.claimId).toBe(payload.claimId);
      expect(response.body.metadata.packageId).toBe(payload.packageId);
      expect(response.body.metadata.network).toBe('testnet');
    });
  });
});
