import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClaimStatus, CampaignStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module'; // Changed from 'src/app.module' to relative import
import { PrismaService } from '../src/prisma/prisma.service'; // Changed from 'src/prisma/prisma.service' to relative import

type ReviewQueueResponse = {
  items: Array<{
    id: string;
    status: ClaimStatus;
    campaignId: string;
    createdAt: string;
    campaign: {
      id: string;
      name: string;
      status: string;
      archivedAt: string | null;
    };
  }>;
  pagination:
    | {
        mode: 'page';
        page: number;
        limit: number;
        totalItems: number;
        totalPages: number;
        hasNextPage: boolean;
      }
    | {
        mode: 'cursor';
        limit: number;
        nextCursor: string | null;
        hasNextPage: boolean;
      };
  filters: {
    status?: ClaimStatus[];
    campaignId?: string;
    fromDate?: string;
    toDate?: string;
  };
};

describe('Verification review queue (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const base = '/api/v1/verification/review-queue';
  const apiKey = 'verification-review-queue-test-key';

  beforeAll(async () => {
    process.env.API_KEY = apiKey;

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
    await prisma.claim.deleteMany();
    await prisma.campaign.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (req: request.Test) => req.set('x-api-key', apiKey);

  async function seedQueueFixture() {
    const campaignA = await prisma.campaign.create({
      data: {
        name: 'Queue Campaign A',
        budget: 1000,
        status: CampaignStatus.active, // Use enum
      },
    });

    const campaignB = await prisma.campaign.create({
      data: {
        name: 'Queue Campaign B',
        budget: 2000,
        status: CampaignStatus.paused, // Use enum
      },
    });

    const oldest = new Date('2026-02-01T08:00:00.000Z');
    const middle = new Date('2026-02-02T09:00:00.000Z');
    const newest = new Date('2026-02-03T10:00:00.000Z');

    const requestedA = await prisma.claim.create({
      data: {
        campaignId: campaignA.id,
        amount: 125,
        recipientRef: 'recipient-a',
        evidenceRef: 'evidence-a',
        status: ClaimStatus.requested, // Use enum
        createdAt: middle,
      },
    });

    const verifiedA = await prisma.claim.create({
      data: {
        campaignId: campaignA.id,
        amount: 150,
        recipientRef: 'recipient-b',
        evidenceRef: 'evidence-b',
        status: ClaimStatus.verified, // Use enum
        createdAt: oldest,
      },
    });

    const requestedB = await prisma.claim.create({
      data: {
        campaignId: campaignB.id,
        amount: 175,
        recipientRef: 'recipient-c',
        evidenceRef: 'evidence-c',
        status: ClaimStatus.requested, // Use enum
        createdAt: newest,
      },
    });

    return {
      campaignA,
      campaignB,
      claims: {
        requestedA,
        verifiedA,
        requestedB,
      },
    };
  }

  it('supports page/limit pagination with status and campaign filters', async () => {
    const fixture = await seedQueueFixture();

    const response = await auth(
      request(app.getHttpServer())
        .get(base)
        .query({
          status: [ClaimStatus.requested], // Use enum
          campaignId: fixture.campaignA.id,
          page: 1,
          limit: 10,
        }),
    ).expect(200);

    const body = response.body as ReviewQueueResponse;

    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe(fixture.claims.requestedA.id);
    expect(body.items[0]?.status).toBe(ClaimStatus.requested);
    expect(body.items[0]?.campaignId).toBe(fixture.campaignA.id);
    expect(body.pagination).toMatchObject({
      mode: 'page',
      page: 1,
      limit: 10,
      totalItems: 1,
      totalPages: 1,
      hasNextPage: false,
    });
    expect(body.filters).toEqual({
      status: [ClaimStatus.requested],
      campaignId: fixture.campaignA.id,
    });
  });

  it('filters by createdAt date range', async () => {
    const fixture = await seedQueueFixture();

    const response = await auth(
      request(app.getHttpServer()).get(base).query({
        fromDate: '2026-02-02T00:00:00.000Z',
        toDate: '2026-02-03T00:00:00.000Z',
      }),
    ).expect(200);

    const body = response.body as ReviewQueueResponse;
    const returnedIds = body.items.map(item => item.id);

    expect(returnedIds).toEqual([fixture.claims.requestedA.id]);
    expect(body.filters).toEqual({
      fromDate: '2026-02-02T00:00:00.000Z',
      toDate: '2026-02-03T00:00:00.000Z',
    });
  });

  it('supports cursor pagination from the first request', async () => {
    const fixture = await seedQueueFixture();

    const firstCursorResponse = await auth(
      request(app.getHttpServer()).get(base).query({
        paginationMode: 'cursor',
        limit: 2,
      }),
    ).expect(200);

    const firstCursorPage = firstCursorResponse.body as ReviewQueueResponse;

    expect(firstCursorPage.items.map(item => item.id)).toEqual([
      fixture.claims.requestedB.id,
      fixture.claims.requestedA.id,
    ]);
    expect(firstCursorPage.pagination).toMatchObject({
      mode: 'cursor',
      limit: 2,
      hasNextPage: true,
    });

    // Type guard to safely access nextCursor
    if (firstCursorPage.pagination.mode === 'cursor') {
      expect(firstCursorPage.pagination.nextCursor).toEqual(expect.any(String));
    }

    const nextCursor =
      firstCursorPage.pagination.mode === 'cursor'
        ? firstCursorPage.pagination.nextCursor
        : null;

    const nextCursorResponse = await auth(
      request(app.getHttpServer()).get(base).query({
        paginationMode: 'cursor',
        cursor: nextCursor,
        limit: 2,
      }),
    ).expect(200);

    const nextCursorPage = nextCursorResponse.body as ReviewQueueResponse;

    expect(nextCursorPage.items.map(item => item.id)).toEqual([
      fixture.claims.verifiedA.id,
    ]);
    expect(nextCursorPage.pagination).toMatchObject({
      mode: 'cursor',
      limit: 2,
      hasNextPage: false,
    });

    // Type guard to safely access nextCursor
    if (nextCursorPage.pagination.mode === 'cursor') {
      expect(nextCursorPage.pagination.nextCursor).toBeNull();
    }
  });

  it('returns nextCursor when cursor pagination has more results', async () => {
    await seedQueueFixture();

    const response = await auth(
      request(app.getHttpServer())
        .get(base)
        .query({
          paginationMode: 'cursor',
          status: [ClaimStatus.requested, ClaimStatus.verified], // Use enum
          limit: 2,
        }),
    ).expect(200);

    const body = response.body as ReviewQueueResponse;

    expect(body.items).toHaveLength(2);
    expect(body.pagination.mode).toBe('cursor');
    expect(body.pagination.hasNextPage).toBe(true);

    // Type guard to safely access nextCursor
    if (body.pagination.mode === 'cursor') {
      expect(body.pagination.nextCursor).toEqual(expect.any(String));
    }
  });

  it('rejects invalid query combinations and values', async () => {
    await auth(
      request(app.getHttpServer())
        .get(base)
        .query({ paginationMode: 'cursor', page: 1, limit: 10 }),
    ).expect(400);

    await auth(
      request(app.getHttpServer())
        .get(base)
        .query({ paginationMode: 'page', cursor: 'Zm9v', limit: 10 }),
    ).expect(400);

    await auth(
      request(app.getHttpServer()).get(base).query({
        fromDate: '2026-02-03T00:00:00.000Z',
        toDate: '2026-02-01T00:00:00.000Z',
      }),
    ).expect(400);

    await auth(
      request(app.getHttpServer())
        .get(base)
        .query({ status: 'not-a-real-status' }),
    ).expect(400);
  });
});
