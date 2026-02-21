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

type CampaignResponseDto = {
  id: string;
  name: string;
  budget: number;
  archivedAt: string | null;
};

function bodyAs<T>(res: SupertestResponse): ApiResponse<T> {
  // supertest Response.body is `any`; we cast once here to satisfy strict ESLint rules
  return res.body as ApiResponse<T>;
}

describe('Campaigns (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const base = '/api/v1/campaigns';

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
    await prisma.campaign.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /campaigns creates a campaign', async () => {
    const res = await request(app.getHttpServer())
      .post(base)
      .send({ name: 'Test Campaign', budget: 1000 })
      .expect(201);

    const body = bodyAs<CampaignResponseDto>(res);

    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Test Campaign');
    expect(body.data.budget).toBeDefined();
  });

  it('POST /campaigns rejects missing required fields', async () => {
    await request(app.getHttpServer())
      .post(base)
      .send({ budget: 1000 })
      .expect(400);

    await request(app.getHttpServer())
      .post(base)
      .send({ name: 'Missing Budget' })
      .expect(400);
  });

  it('POST /campaigns rejects invalid budgets', async () => {
    await request(app.getHttpServer())
      .post(base)
      .send({ name: 'Bad Budget', budget: -1 })
      .expect(400);
  });

  it('PATCH /campaigns/:id/archive is idempotent', async () => {
    const createdRes = await request(app.getHttpServer())
      .post(base)
      .send({ name: 'Archive Me', budget: 10 })
      .expect(201);

    const createdBody = bodyAs<CampaignResponseDto>(createdRes);
    const id = createdBody.data.id;

    const firstRes = await request(app.getHttpServer())
      .patch(`${base}/${id}/archive`)
      .expect(200);

    const firstBody = bodyAs<CampaignResponseDto>(firstRes);

    expect(firstBody.success).toBe(true);
    expect(firstBody.data.archivedAt).toBeTruthy();

    const secondRes = await request(app.getHttpServer())
      .patch(`${base}/${id}/archive`)
      .expect(200);

    const secondBody = bodyAs<CampaignResponseDto>(secondRes);

    expect(secondBody.success).toBe(true);
    expect(secondBody.data.archivedAt).toBeTruthy();
    expect(secondBody.message ?? '').toMatch(/already archived/i);
  });

  it('GET /campaigns returns a list', async () => {
    await request(app.getHttpServer())
      .post(base)
      .send({ name: 'List Me', budget: 5 })
      .expect(201);

    const res = await request(app.getHttpServer()).get(base).expect(200);

    const body = bodyAs<CampaignResponseDto[]>(res);

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(1);
  });

  it('GET /campaigns/:id returns 404 for missing campaign', async () => {
    await request(app.getHttpServer())
      .get(`${base}/does-not-exist`)
      .expect(404);
  });
});
