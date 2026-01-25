import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface ClaimResponse {
  id: string;
  status: string;
  amount: number;
  recipientRef: string;
  evidenceRef?: string;
  campaignId: string;
  createdAt: string;
  updatedAt: string;
  campaign: {
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
}

describe('Claims (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await prisma.claim.deleteMany();
    await prisma.aidPackage.deleteMany();
  });

  it('/claims (POST) - create claim', async () => {
    // Create a campaign first
    const campaign = await prisma.aidPackage.create({
      data: { status: 'active' },
    });

    const createClaimDto = {
      campaignId: campaign.id,
      amount: 100.0,
      recipientRef: 'recipient123',
      evidenceRef: 'evidence456',
    };

    const response = await request(app.getHttpServer())
      .post('/claims')
      .send(createClaimDto)
      .expect(201);

    const body = response.body as ClaimResponse;
    expect(body).toHaveProperty('id');
    expect(body.status).toBe('requested');
    expect(body.amount).toBe(100.0);
  });

  it('/claims (GET) - get all claims', async () => {
    const campaign = await prisma.aidPackage.create({
      data: { status: 'active' },
    });

    await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 50.0,
        recipientRef: 'rec1',
      },
    });

    const response = await request(app.getHttpServer())
      .get('/claims')
      .expect(200);

    const body = response.body as ClaimResponse[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
  });

  it('/claims/:id (GET) - get claim by id', async () => {
    const campaign = await prisma.aidPackage.create({
      data: { status: 'active' },
    });

    const claim = await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 75.0,
        recipientRef: 'rec2',
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/claims/${claim.id}`)
      .expect(200);

    const body = response.body as ClaimResponse;
    expect(body.id).toBe(claim.id);
    expect(body.amount).toBe(75.0);
  });

  it('/claims/:id/verify (POST) - verify claim', async () => {
    const campaign = await prisma.aidPackage.create({
      data: { status: 'active' },
    });

    const claim = await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 200.0,
        recipientRef: 'rec3',
        status: 'requested',
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/claims/${claim.id}/verify`)
      .expect(200);

    const body = response.body as ClaimResponse;
    expect(body.status).toBe('verified');
  });

  it('/claims/:id/approve (POST) - approve claim', async () => {
    const campaign = await prisma.aidPackage.create({
      data: { status: 'active' },
    });

    const claim = await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 300.0,
        recipientRef: 'rec4',
        status: 'verified',
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/claims/${claim.id}/approve`)
      .expect(200);

    const body = response.body as ClaimResponse;
    expect(body.status).toBe('approved');
  });

  it('/claims/:id/disburse (POST) - disburse claim', async () => {
    const campaign = await prisma.aidPackage.create({
      data: { status: 'active' },
    });

    const claim = await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 400.0,
        recipientRef: 'rec5',
        status: 'approved',
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/claims/${claim.id}/disburse`)
      .expect(200);

    const body = response.body as ClaimResponse;
    expect(body.status).toBe('disbursed');
  });

  it('/claims/:id/archive (PATCH) - archive claim', async () => {
    const campaign = await prisma.aidPackage.create({
      data: { status: 'active' },
    });

    const claim = await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 500.0,
        recipientRef: 'rec6',
        status: 'disbursed',
      },
    });

    const response = await request(app.getHttpServer())
      .patch(`/claims/${claim.id}/archive`)
      .expect(200);

    const body = response.body as ClaimResponse;
    expect(body.status).toBe('archived');
  });

  it('should fail invalid transition', async () => {
    const campaign = await prisma.aidPackage.create({
      data: { status: 'active' },
    });

    const claim = await prisma.claim.create({
      data: {
        campaignId: campaign.id,
        amount: 100.0,
        recipientRef: 'rec7',
        status: 'requested',
      },
    });

    // Try to approve without verifying
    await request(app.getHttpServer())
      .post(`/claims/${claim.id}/approve`)
      .expect(400);
  });
});
