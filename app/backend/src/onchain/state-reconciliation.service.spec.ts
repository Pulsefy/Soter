import { Test, TestingModule } from '@nestjs/testing';
import { StateReconciliationService } from './state-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';

describe('StateReconciliationService', () => {
  let service: StateReconciliationService;
  let prisma: PrismaService;
  let onchainAdapter: any;

  beforeEach(async () => {
    onchainAdapter = {
      getAidPackage: jest.fn(),
      getAidPackageCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateReconciliationService,
        {
          provide: PrismaService,
          useValue: {
            aidPackage: {
              findMany: jest.fn(),
              aggregate: jest.fn(),
            },
            driftIncidentLog: {
              create: jest.fn(),
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: ONCHAIN_ADAPTER_TOKEN,
          useValue: onchainAdapter,
        },
      ],
    }).compile();

    service = module.get<StateReconciliationService>(
      StateReconciliationService,
    );
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should detect no drift when states match', async () => {
    (prisma.aidPackage.findMany as jest.Mock).mockResolvedValue([
      { id: '1', status: 'Created', totalAmount: 100 },
    ]);
    onchainAdapter.getAidPackage.mockResolvedValue({
      package: { status: 'Created', amount: '100' },
    });
    onchainAdapter.getAidPackageCount.mockResolvedValue({
      aggregates: { totalCommitted: '100' },
    });
    (prisma.aidPackage.aggregate as jest.Mock).mockResolvedValue({
      _sum: { totalAmount: 100 },
    });

    const result = await service.reconcileAll();

    expect(result.packagesDrifted).toBe(0);
    expect(result.totalsDrifted).toBe(0);
    expect(prisma.driftIncidentLog.create).not.toHaveBeenCalled();
  });

  it('should detect drift in package status', async () => {
    (prisma.aidPackage.findMany as jest.Mock).mockResolvedValue([
      { id: '1', status: 'Created', totalAmount: 100 },
    ]);
    onchainAdapter.getAidPackage.mockResolvedValue({
      package: { status: 'Claimed', amount: '100' },
    });
    onchainAdapter.getAidPackageCount.mockResolvedValue({
      aggregates: { totalCommitted: '100' },
    });
    (prisma.aidPackage.aggregate as jest.Mock).mockResolvedValue({
      _sum: { totalAmount: 100 },
    });

    const result = await service.reconcileAll();

    expect(result.packagesDrifted).toBe(1);
    expect(prisma.driftIncidentLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'AidPackage',
        field: 'status',
        onChainValue: 'Claimed',
        cachedValue: 'Created',
      }),
    });
  });

  it('should detect drift in locked totals', async () => {
    (prisma.aidPackage.findMany as jest.Mock).mockResolvedValue([]);
    onchainAdapter.getAidPackageCount.mockResolvedValue({
      aggregates: { totalCommitted: '200' },
    });
    (prisma.aidPackage.aggregate as jest.Mock).mockResolvedValue({
      _sum: { totalAmount: 100 },
    });

    const result = await service.reconcileAll();

    expect(result.totalsDrifted).toBe(1);
    expect(prisma.driftIncidentLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'Global',
        field: 'totalCommitted',
        onChainValue: '200',
        cachedValue: '100',
      }),
    });
  });

  it('should handle empty state', async () => {
    (prisma.aidPackage.findMany as jest.Mock).mockResolvedValue([]);
    onchainAdapter.getAidPackageCount.mockResolvedValue({
      aggregates: { totalCommitted: '0' },
    });
    (prisma.aidPackage.aggregate as jest.Mock).mockResolvedValue({
      _sum: { totalAmount: 0 },
    });

    const result = await service.reconcileAll();

    expect(result.packagesChecked).toBe(0);
    expect(result.packagesDrifted).toBe(0);
    expect(result.totalsDrifted).toBe(0);
  });
});
