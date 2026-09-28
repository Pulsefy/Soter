import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { BudgetService } from 'src/common/budget/budget.service';
import { App } from 'supertest/types';

// A syntactically valid Stellar account address, required by CreateClaimDto's
// tokenAddress validator.
const TOKEN_ADDRESS = 'G' + 'A'.repeat(55);

const base = '/api/v1/claims';

function makeClaimPayload(campaignId: string, amount: number, i: number) {
  return {
    campaignId,
    amount,
    recipientRef: `recipient-${i}`,
    tokenAddress: TOKEN_ADDRESS,
  };
}

describe('Campaign budget enforcement under concurrent claim creation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [BudgetService, PrismaService],
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
    await prisma.balanceLedger.deleteMany();
    await prisma.claim.deleteMany();
    await prisma.campaign.deleteMany();
  });

  afterAll(async () => {
    await prisma.balanceLedger.deleteMany();
    await prisma.claim.deleteMany();
    await prisma.campaign.deleteMany();
    await app.close();
  });

  it('never admits more claims than the campaign budget allows, even when created concurrently', async () => {
    const AMOUNT = 100;
    const BUDGET = 300;
    const CONCURRENT_REQUESTS = 10;
    const MAX_ADMISSIBLE = BUDGET / AMOUNT; // 3

    const campaign = await prisma.campaign.create({
      data: { name: 'Concurrency Test Campaign', budget: BUDGET },
    });

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
        request(app.getHttpServer())
          .post(base)
          .send(makeClaimPayload(campaign.id, AMOUNT, i)),
      ),
    );

    const accepted = responses.filter(r => r.status === 201);
    const rejected = responses.filter(r => r.status !== 201);

    // Exactly the budget-allowed number of claims were admitted — not more
    // (over-commit) and not fewer (false rejections under contention).
    expect(accepted).toHaveLength(MAX_ADMISSIBLE);
    expect(rejected).toHaveLength(CONCURRENT_REQUESTS - MAX_ADMISSIBLE);

    // Cross-check against what's actually persisted: total claimed amount
    // for the campaign must never exceed its budget.
    const persistedClaims = await prisma.claim.findMany({
      where: { campaignId: campaign.id },
    });
    const totalClaimed = persistedClaims.reduce((sum, c) => sum + c.amount, 0);
    expect(persistedClaims).toHaveLength(MAX_ADMISSIBLE);
    expect(totalClaimed).toBeLessThanOrEqual(BUDGET);

    // The budget check is backed by a real ledger entry per admitted claim
    // (not just an in-memory count), and no ledger entries were written for
    // rejected attempts.
    const lockEntries = await prisma.balanceLedger.findMany({
      where: { campaignId: campaign.id, eventType: 'lock' },
    });
    expect(lockEntries).toHaveLength(MAX_ADMISSIBLE);
    const totalLocked = lockEntries.reduce((sum, l) => sum + l.amount, 0);
    expect(totalLocked).toBeLessThanOrEqual(BUDGET);

    // Documented failure mode: a rejected claim gets a 400 with a clear
    // reason, and leaves no trace (no claim row, no ledger row).
    for (const res of rejected) {
      expect(res.body).toMatchObject({
        code: 400,
        errorCode: 'BAD_REQUEST',
        message: expect.stringContaining('Campaign funding cap exceeded'),
      });
    }
  });

  it('rejects a single over-budget claim with the documented failure response and writes nothing', async () => {
    const campaign = await prisma.campaign.create({
      data: { name: 'Over-budget Test Campaign', budget: 50 },
    });

    const res = await request(app.getHttpServer())
      .post(base)
      .send(makeClaimPayload(campaign.id, 100, 0))
      .expect(400);

    expect(res.body).toMatchObject({
      code: 400,
      errorCode: 'BAD_REQUEST',
      message: expect.stringContaining('Campaign funding cap exceeded'),
    });

    const claims = await prisma.claim.findMany({
      where: { campaignId: campaign.id },
    });
    const ledgerEntries = await prisma.balanceLedger.findMany({
      where: { campaignId: campaign.id },
    });
    expect(claims).toHaveLength(0);
    expect(ledgerEntries).toHaveLength(0);
  });
});
