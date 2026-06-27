import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HmacService } from '../src/common/hmac/hmac.service';
import request from 'supertest';
import http from 'http';
import { ClaimStatus } from '@prisma/client';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

describe('Webhook Delivery E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hmacService: HmacService;
  let _webhooksQueue: Queue;
  let server: http.Server;
  let receivedRequests: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];
  let serverPort: number;

  beforeAll(async () => {
    // Start local server to receive webhooks
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        receivedRequests.push({
          headers: req.headers,
          body: body ? JSON.parse(body) : null,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        serverPort = typeof address === 'string' ? 3002 : address?.port || 3002;
        resolve();
      });
    });

    process.env.VERIFICATION_WEBHOOK_URL = `http://localhost:${serverPort}/webhook`;
    process.env.WEBHOOK_MAX_ATTEMPTS = '2';
    process.env.WEBHOOK_BACKOFF_DELAY_MS = '1000';
    process.env.WEBHOOK_SECRET = 'test-webhook-secret-123';
    process.env.API_KEY = 'test-api-key-123';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'v',
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    hmacService = moduleFixture.get<HmacService>(HmacService);
    _webhooksQueue = moduleFixture.get<Queue>(getQueueToken('webhooks'));
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  it('should deliver claim verification result via signed webhook', async () => {
    // 1. Create a test campaign and claim
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Webhook E2E Campaign',
        budget: 1000,
        status: 'active',
      },
    });

    const claim = await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 100.0,
        recipientRef: 'webhook-user',
        evidenceRef: 'http://localhost/evidence.png',
        status: ClaimStatus.requested,
      },
    });

    // 2. Enqueue and process verification
    const response = await request(app.getHttpServer())
      .post(`/api/v1/verification/claims/${claim.id}/enqueue`)
      .set('x-api-key', 'test-api-key-123')
      .expect(202);

    expect(response.body).toHaveProperty('jobId');

    // 3. Wait for the queue processing and webhook delivery
    // We poll the db until WebhookDelivery record is created and sent
    let deliveryRecord: any = null;
    for (let i = 0; i < 20; i++) {
      deliveryRecord = await prisma.webhookDelivery.findFirst({
        where: { entityId: claim.id },
      });
      if (deliveryRecord && deliveryRecord.status === 'sent') {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    expect(deliveryRecord).toBeDefined();
    expect(deliveryRecord.status).toBe('sent');

    // 4. Verify received webhook request
    expect(receivedRequests.length).toBeGreaterThanOrEqual(1);
    const webhookReq = receivedRequests[0];
    
    // Check HMAC signature validation
    const receivedSignature = webhookReq.headers['x-webhook-signature'] as string;
    expect(receivedSignature).toBeDefined();
    
    const rawBody = JSON.stringify(webhookReq.body);
    const isValid = hmacService.verify(rawBody, receivedSignature);
    expect(isValid).toBe(true);

    // Verify payload schema
    expect(webhookReq.body).toEqual(expect.objectContaining({
      event: 'verification.completed',
      claimId: claim.id,
      deliveryId: deliveryRecord.id,
      timestamp: expect.any(String),
    }));

    // Clean up
    await prisma.claim.delete({ where: { id: claim.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
  });

  it('should support manual replay of delivery records', async () => {
    // 1. Create a dummy delivery record marked as failed
    const failedDelivery = await prisma.webhookDelivery.create({
      data: {
        url: `http://localhost:${serverPort}/webhook-replay`,
        payload: JSON.stringify({ event: 'test.replay', entityId: 'dummy-1' }),
        status: 'failed',
        entityId: 'dummy-1',
        entityType: 'claim',
        retryCount: 2,
        lastError: 'Simulated failure',
      },
    });

    // 2. Trigger replay via controller endpoint
    const response = await request(app.getHttpServer())
      .post(`/api/v1/verification/webhooks/${failedDelivery.id}/replay`)
      .set('x-api-key', 'test-api-key-123')
      .expect(201);

    expect(response.body.status).toBe('pending');
    expect(response.body.retryCount).toBe(0);

    // 3. Wait for the delivery to be retried and marked sent
    let replayedRecord: any = null;
    for (let i = 0; i < 20; i++) {
      replayedRecord = await prisma.webhookDelivery.findUnique({
        where: { id: failedDelivery.id },
      });
      if (replayedRecord && replayedRecord.status === 'sent') {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    expect(replayedRecord.status).toBe('sent');
    expect(receivedRequests.length).toBeGreaterThanOrEqual(1);

    // Clean up
    await prisma.webhookDelivery.delete({ where: { id: failedDelivery.id } });
  });
});
