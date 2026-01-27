import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request, { Response as SupertestResponse } from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { App } from 'supertest/types';

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

describe('Claims (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const base = '/api/v1/claims';

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
    await prisma.claim.deleteMany();
    await prisma.campaign.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /claims creates a claim', async () => {
    // Create a campaign first
    const campaign = await prisma.campaign.create({
      data: { name: 'Test Campaign', budget: 1000 },
    });

    const res = await request(app.getHttpServer())
      .post(base)
      .send({
        campaignId: campaign.id,
        amount: 100.5,
        recipientRef: 'recipient-123',
        evidenceRef: 'evidence-456',
      })
      .expect(201);

    const body = bodyAs<ClaimResponseDto>(res);

    expect(body.success).toBe(true);
    expect(body.data.status).toBe('requested');
    expect(body.data.amount).toBe(100.5);
    expect(body.data.recipientRef).toBe('recipient-123');
    expect(body.data.evidenceRef).toBe('evidence-456');
    expect(body.data.campaign.id).toBe(campaign.id);
  });

  it('POST /claims rejects invalid campaignId', async () => {
    await request(app.getHttpServer())
      .post(base)
      .send({
        campaignId: 'invalid-id',
        amount: 100.5,
        recipientRef: 'recipient-123',
      })
      .expect(404);
  });

  it('GET /claims returns all claims', async () => {
    const campaign = await prisma.campaign.create({
      data: { name: 'Test Campaign', budget: 1000 },
    });

    await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 50,
        recipientRef: 'recipient-1',
      },
    });

    const res = await request(app.getHttpServer()).get(base).expect(200);

    const body = bodyAs<ClaimResponseDto[]>(res);

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });

  it('GET /claims/:id returns claim details', async () => {
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
      .get(`${base}/${claim.id}`)
      .expect(200);

    const body = bodyAs<ClaimResponseDto>(res);

    expect(body.success).toBe(true);
    expect(body.data.id).toBe(claim.id);
    expect(body.data.status).toBe('requested');
  });

  it('POST /claims/:id/verify transitions requested to verified', async () => {
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
      .post(`${base}/${claim.id}/verify`)
      .expect(200);

    const body = bodyAs<ClaimResponseDto>(res);

    expect(body.success).toBe(true);
    expect(body.data.status).toBe('verified');
  });

  it('POST /claims/:id/approve transitions verified to approved', async () => {
    const campaign = await prisma.campaign.create({
      data: { name: 'Test Campaign', budget: 1000 },
    });

    const claim = await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 50,
        recipientRef: 'recipient-1',
        status: 'verified',
      },
    });

    const res = await request(app.getHttpServer())
      .post(`${base}/${claim.id}/approve`)
      .expect(200);

    const body = bodyAs<ClaimResponseDto>(res);

    expect(body.success).toBe(true);
    expect(body.data.status).toBe('approved');
  });

  it('POST /claims/:id/disburse transitions approved to disbursed', async () => {
    const campaign = await prisma.campaign.create({
      data: { name: 'Test Campaign', budget: 1000 },
    });

    const claim = await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 50,
        recipientRef: 'recipient-1',
        status: 'approved',
      },
    });

    const res = await request(app.getHttpServer())
      .post(`${base}/${claim.id}/disburse`)
      .expect(200);

    const body = bodyAs<ClaimResponseDto>(res);

    expect(body.success).toBe(true);
    expect(body.data.status).toBe('disbursed');
  });

  it('PATCH /claims/:id/archive transitions disbursed to archived', async () => {
    const campaign = await prisma.campaign.create({
      data: { name: 'Test Campaign', budget: 1000 },
    });

    const claim = await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 50,
        recipientRef: 'recipient-1',
        status: 'disbursed',
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`${base}/${claim.id}/archive`)
      .expect(200);

    const body = bodyAs<ClaimResponseDto>(res);

    expect(body.success).toBe(true);
    expect(body.data.status).toBe('archived');
  });

  it('POST /claims/:id/verify rejects invalid transition', async () => {
    const campaign = await prisma.campaign.create({
      data: { name: 'Test Campaign', budget: 1000 },
    });

    const claim = await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 50,
        recipientRef: 'recipient-1',
        status: 'verified', // Already verified
      },
    });

    await request(app.getHttpServer())
      .post(`${base}/${claim.id}/verify`)
      .expect(400);
  });
});
