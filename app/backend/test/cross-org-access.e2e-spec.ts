import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { BudgetService } from 'src/common/budget/budget.service';

describe('Cross-org access protection (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const base = '/api/v1/claims';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [BudgetService, PrismaService],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.apiKey.deleteMany();
    await prisma.claim.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.organization.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies access when NGO API key tries to read a claim belonging to another org', async () => {
    const orgA = await prisma.organization.create({ data: { name: 'Org A' } });
    const orgB = await prisma.organization.create({ data: { name: 'Org B' } });

    const campaignB = await prisma.campaign.create({ data: { name: 'Campaign B', budget: 1000, orgId: orgB.id } });

    const claim = await prisma.claim.create({ data: { campaignId: campaignB.id, amount: 10, recipientRef: 'r1' } });

    // create an API key scoped to orgA (ngo)
    await prisma.apiKey.create({ data: { key: 'ngo-key-1', role: 'ngo', ngoId: orgA.id } });

    await request(app.getHttpServer())
      .get(`${base}/${claim.id}`)
      .set('x-api-key', 'ngo-key-1')
      .expect(403);
  });
});
