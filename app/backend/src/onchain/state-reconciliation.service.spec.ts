import { Test, TestingModule } from '@nestjs/testing';
import { StateReconciliationService } from './state-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';

/* ------------------------------------------------------------------ */
/*  Stubs                                                              */
/* ------------------------------------------------------------------ */

const mockPrisma = {
  aidPackage: { findMany: jest.fn() },
  campaign: { findMany: jest.fn() },
  balanceLedger: { aggregate: jest.fn() },
  driftIncident: {
    createMany: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
};

const mockOnchain = {
  getAidPackage: jest.fn(),
  getAidPackageCount: jest.fn(),
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('StateReconciliationService', () => {
  let service: StateReconciliationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateReconciliationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ONCHAIN_ADAPTER_TOKEN, useValue: mockOnchain },
      ],
    }).compile();

    service = module.get(StateReconciliationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /* -------------------------------------------------------------- */
  /*  reconcile()                                                    */
  /* -------------------------------------------------------------- */

  describe('reconcile', () => {
    it('returns zero drifts when all states match', async () => {
      mockPrisma.aidPackage.findMany.mockResolvedValue([
        {
          id: 'pkg_1',
          status: 'active',
          totalAmount: 100,
          claimedAmount: 0,
          remainingAmount: 100,
          campaignId: 'camp_1',
        },
      ]);
      mockOnchain.getAidPackage.mockResolvedValue({
        package: {
          id: 'pkg_1',
          recipient: 'GABC',
          amount: '1000000000', // 100 * 1e7 stroops
          token: 'TOKEN',
          status: 'Created',
          createdAt: 0,
          expiresAt: 9999999999,
        },
      });
      mockPrisma.campaign.findMany.mockResolvedValue([]);
      mockPrisma.driftIncident.createMany.mockResolvedValue({ count: 0 });

      const result = await service.reconcile();

      expect(result.driftsDetected).toBe(0);
      expect(result.drifts).toHaveLength(0);
      expect(result.packagesChecked).toBe(1);
      expect(result.campaignsChecked).toBe(0);
      expect(mockPrisma.driftIncident.createMany).not.toHaveBeenCalled();
    });

    it('detects status mismatch between on-chain and backend', async () => {
      mockPrisma.aidPackage.findMany.mockResolvedValue([
        {
          id: 'pkg_2',
          status: 'draft', // backend says draft
          totalAmount: 50,
          claimedAmount: 0,
          remainingAmount: 50,
          campaignId: 'camp_1',
        },
      ]);
      mockOnchain.getAidPackage.mockResolvedValue({
        package: {
          id: 'pkg_2',
          recipient: 'GDEF',
          amount: '500000000',
          token: 'TOKEN',
          status: 'Claimed', // on-chain says Claimed
          createdAt: 0,
          expiresAt: 9999999999,
        },
      });
      mockPrisma.campaign.findMany.mockResolvedValue([]);
      mockPrisma.driftIncident.createMany.mockResolvedValue({ count: 1 });

      const result = await service.reconcile();

      expect(result.driftsDetected).toBeGreaterThanOrEqual(1);
      const statusDrift = result.drifts.find(
        (d) => d.kind === 'status_mismatch',
      );
      expect(statusDrift).toBeDefined();
      expect(statusDrift!.packageId).toBe('pkg_2');
      expect(statusDrift!.severity).toBe('high');
      expect(result.packagesChecked).toBe(1);
    });

    it('detects amount mismatch with correct severity', async () => {
      mockPrisma.aidPackage.findMany.mockResolvedValue([
        {
          id: 'pkg_3',
          status: 'active',
          totalAmount: 200, // backend: 200
          claimedAmount: 0,
          remainingAmount: 200,
          campaignId: 'camp_1',
        },
      ]);
      mockOnchain.getAidPackage.mockResolvedValue({
        package: {
          id: 'pkg_3',
          recipient: 'GHIJ',
          amount: '1500000000', // on-chain: 150 units (25% drift → critical)
          token: 'TOKEN',
          status: 'Created',
          createdAt: 0,
          expiresAt: 9999999999,
        },
      });
      mockPrisma.campaign.findMany.mockResolvedValue([]);
      mockPrisma.driftIncident.createMany.mockResolvedValue({ count: 1 });

      const result = await service.reconcile();

      const amountDrift = result.drifts.find(
        (d) => d.kind === 'amount_mismatch',
      );
      expect(amountDrift).toBeDefined();
      expect(amountDrift!.severity).toBe('critical');
    });

    it('detects package missing on-chain', async () => {
      mockPrisma.aidPackage.findMany.mockResolvedValue([
        {
          id: 'pkg_ghost',
          status: 'active',
          totalAmount: 75,
          claimedAmount: 0,
          remainingAmount: 75,
          campaignId: 'camp_2',
        },
      ]);
      mockOnchain.getAidPackage.mockRejectedValue(
        new Error('not found'),
      );
      mockPrisma.campaign.findMany.mockResolvedValue([]);
      mockPrisma.driftIncident.createMany.mockResolvedValue({ count: 1 });

      const result = await service.reconcile();

      expect(result.driftsDetected).toBe(1);
      expect(result.drifts[0].kind).toBe('package_missing_onchain');
      expect(result.drifts[0].severity).toBe('critical');
      expect(result.packagesChecked).toBe(1);
    });

    it('detects locked-total mismatch between ledger and on-chain', async () => {
      mockPrisma.aidPackage.findMany.mockResolvedValue([]);
      mockPrisma.campaign.findMany.mockResolvedValue([
        {
          id: 'camp_10',
          budget: 10000,
          metadata: { tokenAddress: 'TOKEN_ADDR' },
        },
      ]);
      // Backend ledger says 500 locked
      mockPrisma.balanceLedger.aggregate.mockResolvedValue({
        _sum: { amount: 500 },
      });
      // On-chain says 6000000000 stroops = 600 units (20% drift)
      mockOnchain.getAidPackageCount.mockResolvedValue({
        aggregates: {
          totalCommitted: '6000000000',
          totalClaimed: '0',
          totalExpiredCancelled: '0',
        },
      });
      mockPrisma.driftIncident.createMany.mockResolvedValue({ count: 1 });

      const result = await service.reconcile();

      const totalDrift = result.drifts.find(
        (d) => d.kind === 'locked_total_mismatch',
      );
      expect(totalDrift).toBeDefined();
      expect(totalDrift!.severity).toBe('critical');
      expect(result.packagesChecked).toBe(0);
      expect(result.campaignsChecked).toBe(1);
    });
  });

  /* -------------------------------------------------------------- */
  /*  getDriftHistory                                                  */
  /* -------------------------------------------------------------- */

  describe('getDriftHistory', () => {
    it('returns paginated results', async () => {
      const fakeIncidents = [{ id: 'inc_1', kind: 'status_mismatch' }];
      mockPrisma.driftIncident.findMany.mockResolvedValue(fakeIncidents);
      mockPrisma.driftIncident.count.mockResolvedValue(1);

      const result = await service.getDriftHistory({
        campaignId: 'camp_1',
        limit: 10,
        offset: 0,
      });

      expect(result.items).toEqual(fakeIncidents);
      expect(result.total).toBe(1);
      expect(mockPrisma.driftIncident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { campaignId: 'camp_1' },
          take: 10,
          skip: 0,
        }),
      );
    });
  });

  /* -------------------------------------------------------------- */
  /*  resolveDrift                                                     */
  /* -------------------------------------------------------------- */

  describe('resolveDrift', () => {
    it('marks an incident as manually_resolved', async () => {
      const updated = {
        id: 'inc_1',
        resolution: 'manually_resolved',
        resolvedBy: 'admin@test.com',
      };
      mockPrisma.driftIncident.update.mockResolvedValue(updated);

      const result = await service.resolveDrift(
        'inc_1',
        'admin@test.com',
        'Fixed in contract',
      );

      expect(result.resolution).toBe('manually_resolved');
      expect(mockPrisma.driftIncident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inc_1' },
          data: expect.objectContaining({
            resolution: 'manually_resolved',
            resolvedBy: 'admin@test.com',
          }),
        }),
      );
    });
  });
});
