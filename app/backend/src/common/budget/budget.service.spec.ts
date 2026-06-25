import { BudgetService } from './budget.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('BudgetService', () => {
  let budgetService: BudgetService;
  let prisma: PrismaService;

  beforeEach(() => {
    // Create a plain mock structure that mirrors the client sub-delegates
    prisma = {
      campaign: { findUnique: jest.fn() },
      balanceLedger: { aggregate: jest.fn() },
    } as unknown as PrismaService;

    budgetService = new BudgetService(prisma);
  });

  it('should allow within budget', async () => {
    (prisma.campaign.findUnique as jest.Mock).mockResolvedValue({
      id: 'c1',
      budget: 100,
    });

    const aggregateMock = prisma.balanceLedger.aggregate as jest.Mock;
    aggregateMock
      .mockResolvedValueOnce({ _sum: { amount: 30 } }) // locked
      .mockResolvedValueOnce({ _sum: { amount: 20 } }); // disbursed

    await expect(
      budgetService.assertWithinBudget('c1', 40),
    ).resolves.toBeUndefined();
  });

  it('should reject if over budget', async () => {
    (prisma.campaign.findUnique as jest.Mock).mockResolvedValue({
      id: 'c1',
      budget: 100,
    });

    const aggregateMock = prisma.balanceLedger.aggregate as jest.Mock;
    aggregateMock
      .mockResolvedValueOnce({ _sum: { amount: 60 } }) // locked
      .mockResolvedValueOnce({ _sum: { amount: 30 } }); // disbursed

    await expect(budgetService.assertWithinBudget('c1', 20)).rejects.toThrow(
      'Campaign funding cap exceeded',
    );
  });

  it('should throw if campaign not found', async () => {
    (prisma.campaign.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(budgetService.assertWithinBudget('bad', 10)).rejects.toThrow(
      'Campaign not found',
    );
  });
});

