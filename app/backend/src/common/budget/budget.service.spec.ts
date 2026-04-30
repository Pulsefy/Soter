import { BudgetService } from './budget.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('BudgetService', () => {
  let budgetService: BudgetService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      campaign: { findUnique: jest.fn() },
      balanceLedger: { aggregate: jest.fn() },
    } as any;
    budgetService = new BudgetService(prisma as any);
  });

  it('should allow within budget', async () => {
    prisma.campaign.findUnique.mockResolvedValue({ id: 'c1', budget: 100 });
    prisma.balanceLedger.aggregate.mockResolvedValueOnce({
      _sum: { amount: 30 },
    }); // locked
    prisma.balanceLedger.aggregate.mockResolvedValueOnce({
      _sum: { amount: 20 },
    }); // disbursed
    await expect(
      budgetService.assertWithinBudget('c1', 40),
    ).resolves.toBeUndefined();
  });

  it('should reject if over budget', async () => {
    prisma.campaign.findUnique.mockResolvedValue({ id: 'c1', budget: 100 });
    prisma.balanceLedger.aggregate.mockResolvedValueOnce({
      _sum: { amount: 60 },
    }); // locked
    prisma.balanceLedger.aggregate.mockResolvedValueOnce({
      _sum: { amount: 30 },
    }); // disbursed
    await expect(budgetService.assertWithinBudget('c1', 20)).rejects.toThrow(
      'Campaign funding cap exceeded',
    );
  });

  it('should throw if campaign not found', async () => {
    prisma.campaign.findUnique.mockResolvedValue(null);
    await expect(budgetService.assertWithinBudget('bad', 10)).rejects.toThrow(
      'Campaign not found',
    );
  });
});
