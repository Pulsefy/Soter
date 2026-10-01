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

  describe('reserveBudget (transaction-safe)', () => {
    function mockTx(overrides: {
      campaignRows?: Array<{ id: string; budget: number }>;
      locked?: number;
      disbursed?: number;
    }) {
      const aggregate = jest.fn();
      aggregate
        .mockResolvedValueOnce({ _sum: { amount: overrides.locked ?? 0 } })
        .mockResolvedValueOnce({
          _sum: { amount: overrides.disbursed ?? 0 },
        });

      return {
        $queryRaw: jest.fn().mockResolvedValue(overrides.campaignRows ?? []),
        balanceLedger: { aggregate },
      } as any;
    }

    it('locks the campaign row with SELECT ... FOR UPDATE before summing usage', async () => {
      const tx = mockTx({
        campaignRows: [{ id: 'c1', budget: 100 }],
        locked: 30,
        disbursed: 20,
      });

      await expect(
        budgetService.reserveBudget(tx, 'c1', 40),
      ).resolves.toBeUndefined();

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const queryArg = (tx.$queryRaw as jest.Mock).mock.calls[0][0];
      // Prisma.sql produces an object with a `.sql` (or `.text`) field
      // containing the raw statement text.
      const rawText: string =
        queryArg?.sql ?? queryArg?.text ?? String(queryArg);
      expect(rawText).toContain('FOR UPDATE');
      expect(rawText).toContain('Campaign');
    });

    it('allows a reservation that stays within budget', async () => {
      const tx = mockTx({
        campaignRows: [{ id: 'c1', budget: 100 }],
        locked: 30,
        disbursed: 20,
      });

      await expect(
        budgetService.reserveBudget(tx, 'c1', 40),
      ).resolves.toBeUndefined();
    });

    it('rejects a reservation that would exceed budget', async () => {
      const tx = mockTx({
        campaignRows: [{ id: 'c1', budget: 100 }],
        locked: 60,
        disbursed: 30,
      });

      await expect(budgetService.reserveBudget(tx, 'c1', 20)).rejects.toThrow(
        'Campaign funding cap exceeded',
      );
    });

    it('throws if the campaign row does not exist', async () => {
      const tx = mockTx({ campaignRows: [] });

      await expect(
        budgetService.reserveBudget(tx, 'missing', 10),
      ).rejects.toThrow('Campaign not found');
    });
  });
});
