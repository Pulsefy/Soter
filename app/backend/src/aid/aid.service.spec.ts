import { Test, TestingModule } from '@nestjs/testing';
import { AidService } from './aid.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../../cache/redis.service';
import { AiTaskWebhookDto, TaskStatus } from './dto/ai-task-webhook.dto';
import { MetricsService } from '../observability/metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AidService - Webhook Reliability Checks', () => {
  let service: AidService;
  let redisService: RedisService;
  let auditService: AuditService;
  let redisGetSpy: jest.SpyInstance;
  let redisSetSpy: jest.SpyInstance;
  let auditRecordSpy: jest.SpyInstance;
  let metricsService: { incrementCallbackFailure: jest.Mock };
  let prismaService: {
    campaign: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    aidPackage: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    metricsService = {
      incrementCallbackFailure: jest.fn(),
    };
    prismaService = {
      campaign: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      aidPackage: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AidService,
        {
          provide: AuditService,
          useValue: { record: jest.fn() },
        },
        {
          provide: RedisService,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
        {
          provide: MetricsService,
          useValue: metricsService,
        },
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    service = module.get<AidService>(AidService);
    redisService = module.get<RedisService>(RedisService);
    auditService = module.get<AuditService>(AuditService);

    redisGetSpy = jest.spyOn(redisService, 'get');
    redisSetSpy = jest.spyOn(redisService, 'set');
    auditRecordSpy = jest.spyOn(auditService, 'record');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves and audits the campaign supplied in the request', async () => {
    const campaign = {
      id: 'campaign-from-request',
      orgId: null,
      ngoId: null,
      deletedAt: null,
    };
    prismaService.campaign.findUnique.mockResolvedValue(campaign);

    const result = await service.createCampaign({
      campaignId: campaign.id,
      aidType: 'food',
    });

    expect(result).toEqual({
      id: campaign.id,
      campaignId: campaign.id,
      aidType: 'food',
    });
    expect(prismaService.campaign.findUnique).toHaveBeenCalledWith({
      where: { id: campaign.id },
    });
    expect(auditRecordSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: campaign.id }),
    );
  });

  it('resolves a campaign from the authenticated organization context', async () => {
    const campaign = {
      id: 'campaign-from-org',
      orgId: 'org-1',
      ngoId: null,
      deletedAt: null,
    };
    prismaService.campaign.findFirst.mockResolvedValue(campaign);

    await service.createCampaign({ aidType: 'water' }, { orgId: 'org-1' });

    expect(prismaService.campaign.findFirst).toHaveBeenCalledWith({
      where: { orgId: 'org-1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditRecordSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: campaign.id }),
    );
  });

  it('returns a clear validation error when no valid campaign is resolved', async () => {
    prismaService.campaign.findUnique.mockResolvedValue(null);

    await expect(
      service.createCampaign({ campaignId: 'missing-campaign' }),
    ).rejects.toThrow(
      'A valid campaign could not be resolved from campaignId or the authenticated organization',
    );
    expect(auditRecordSpy).not.toHaveBeenCalled();
  });

  it('1. should successfully process a fresh, valid webhook payload', async () => {
    const payload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-1',
      timestamp: '2024-03-24T10:00:00Z',
      status: TaskStatus.COMPLETED,
    };

    redisGetSpy.mockResolvedValueOnce(null);
    redisGetSpy.mockResolvedValueOnce(null);

    const result = await service.handleTaskWebhook(payload);

    expect(result).toEqual({
      received: true,
      taskId: 'task-1',
      status: 'completed',
    });

    expect(redisSetSpy).toHaveBeenCalledWith(
      'webhook:delivery:del-1',
      true,
      expect.any(Number),
    );
    expect(redisSetSpy).toHaveBeenCalledWith(
      'webhook:task_ts:task-1',
      new Date('2024-03-24T10:00:00Z').getTime(),
      expect.any(Number),
    );
    expect(auditRecordSpy).toHaveBeenCalled();
  });

  it('2. should reject duplicate exact deliveries', async () => {
    const payload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-1',
      timestamp: '2024-03-24T10:00:00Z',
      status: TaskStatus.COMPLETED,
    };

    redisGetSpy.mockResolvedValueOnce(true);

    const result = await service.handleTaskWebhook(payload);

    expect(result).toEqual({
      received: true,
      status: 'ignored',
      reason: 'duplicate_delivery',
    });
    expect(auditRecordSpy).not.toHaveBeenCalled();
  });

  it('3. should reject stale/delayed out-of-order payloads (conflicts)', async () => {
    const stalePayload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-2',
      timestamp: '2024-03-24T09:00:00Z',
      status: TaskStatus.PROCESSING,
    };

    redisGetSpy.mockResolvedValueOnce(null);
    redisGetSpy.mockResolvedValueOnce(
      new Date('2024-03-24T10:00:00Z').getTime(),
    );

    const result = await service.handleTaskWebhook(stalePayload);

    expect(result).toEqual({
      received: true,
      status: 'ignored',
      reason: 'stale_payload',
    });
    expect(auditRecordSpy).not.toHaveBeenCalled();
  });

  it('4. should process a progressive newer payload sequentially', async () => {
    const newerPayload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-3',
      timestamp: '2024-03-24T11:00:00Z',
      status: TaskStatus.COMPLETED,
    };

    redisGetSpy.mockResolvedValueOnce(null);
    redisGetSpy.mockResolvedValueOnce(
      new Date('2024-03-24T10:00:00Z').getTime(),
    );

    const result = await service.handleTaskWebhook(newerPayload);

    expect(result.status).toEqual('completed');
    expect(auditRecordSpy).toHaveBeenCalled();
  });

  it('5. should record callback failures for failed AI tasks', async () => {
    const failedPayload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-4',
      timestamp: '2024-03-24T12:00:00Z',
      status: TaskStatus.FAILED,
      error: 'model_timeout',
    };

    redisGetSpy.mockResolvedValueOnce(null);
    redisGetSpy.mockResolvedValueOnce(null);

    await service.handleTaskWebhook(failedPayload);

    expect(metricsService.incrementCallbackFailure).toHaveBeenCalledWith(
      'ai_task_webhook',
      'model_timeout',
    );
  });
});

describe('AidService - listAidPackages', () => {
  let service: AidService;
  let prismaService: {
    campaign: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    aidPackage: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  const mockPackages = [
    { id: 'pkg-1', status: 'Active', totalAmount: 1000 },
    { id: 'pkg-2', status: 'Claimed', totalAmount: 2000 },
    { id: 'pkg-3', status: 'Expired', totalAmount: 3000 },
  ];

  beforeEach(async () => {
    prismaService = {
      campaign: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      aidPackage: {
        findMany: jest.fn().mockResolvedValue(mockPackages),
        count: jest.fn().mockResolvedValue(mockPackages.length),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AidService,
        {
          provide: AuditService,
          useValue: { record: jest.fn() },
        },
        {
          provide: RedisService,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
        {
          provide: MetricsService,
          useValue: { incrementCallbackFailure: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    service = module.get<AidService>(AidService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns paginated results with default params', async () => {
    const result = await service.listAidPackages({});

    expect(result).toEqual({
      data: mockPackages,
      total: 3,
      page: 1,
      size: 10,
      totalPages: 1,
    });
    expect(prismaService.aidPackage.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { id: 'asc' },
      skip: 0,
      take: 10,
    });
    expect(prismaService.aidPackage.count).toHaveBeenCalledWith({ where: {} });
  });

  it('applies page and size params correctly', async () => {
    const largePackageSet = Array.from({ length: 25 }, (_, i) => ({
      id: `pkg-${i + 1}`,
      status: 'Active',
      totalAmount: (i + 1) * 100,
    }));
    prismaService.aidPackage.findMany.mockResolvedValue(
      largePackageSet.slice(10, 20),
    );
    prismaService.aidPackage.count.mockResolvedValue(25);

    const result = await service.listAidPackages({ page: 2, size: 10 });

    expect(result.total).toBe(25);
    expect(result.page).toBe(2);
    expect(result.size).toBe(10);
    expect(result.totalPages).toBe(3);
    expect(prismaService.aidPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it('clamps page to 1 when given 0 or negative', async () => {
    await service.listAidPackages({ page: 0 });
    expect(prismaService.aidPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 }),
    );

    await service.listAidPackages({ page: -5 });
    expect(prismaService.aidPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 }),
    );
  });

  it('clamps size to max 100', async () => {
    await service.listAidPackages({ size: 500 });
    expect(prismaService.aidPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it('clamps size to min 1', async () => {
    await service.listAidPackages({ size: 0 });
    expect(prismaService.aidPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 }),
    );
  });

  it('filters by status', async () => {
    prismaService.aidPackage.count.mockResolvedValue(1);
    prismaService.aidPackage.findMany.mockResolvedValue([
      { id: 'pkg-1', status: 'Active', totalAmount: 1000 },
    ]);

    const result = await service.listAidPackages({ status: 'Active' });

    expect(result.total).toBe(1);
    expect(prismaService.aidPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'Active' },
      }),
    );
  });

  it('filters by search text (case-insensitive)', async () => {
    prismaService.aidPackage.count.mockResolvedValue(1);

    await service.listAidPackages({ search: 'emergency' });

    expect(prismaService.aidPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              id: expect.objectContaining({
                contains: 'emergency',
                mode: 'insensitive',
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it('applies sorting with desc direction', async () => {
    await service.listAidPackages({ sortBy: 'status', sortDirection: 'desc' });

    expect(prismaService.aidPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { status: 'desc' },
      }),
    );
  });

  it('applies sorting with default asc direction', async () => {
    await service.listAidPackages({ sortBy: 'totalAmount' });

    expect(prismaService.aidPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { totalAmount: 'asc' },
      }),
    );
  });

  it('combines pagination, filters, and sorting', async () => {
    prismaService.aidPackage.count.mockResolvedValue(15);
    prismaService.aidPackage.findMany.mockResolvedValue(
      mockPackages.slice(0, 5),
    );

    const result = await service.listAidPackages({
      page: 2,
      size: 5,
      status: 'Active',
      search: 'test',
      sortBy: 'status',
      sortDirection: 'desc',
    });

    expect(result.page).toBe(2);
    expect(result.size).toBe(5);
    expect(result.total).toBe(15);
    expect(result.totalPages).toBe(3);
    expect(prismaService.aidPackage.findMany).toHaveBeenCalledWith({
      where: {
        status: 'Active',
        OR: [{ id: { contains: 'test', mode: 'insensitive' } }],
      },
      orderBy: { status: 'desc' },
      skip: 5,
      take: 5,
    });
  });

  it('returns empty data when no packages match', async () => {
    prismaService.aidPackage.findMany.mockResolvedValue([]);
    prismaService.aidPackage.count.mockResolvedValue(0);

    const result = await service.listAidPackages({ status: 'Nonexistent' });

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('calculates totalPages correctly for partial last page', async () => {
    prismaService.aidPackage.count.mockResolvedValue(7);
    prismaService.aidPackage.findMany.mockResolvedValue(
      mockPackages.slice(0, 2),
    );

    const result = await service.listAidPackages({ page: 1, size: 3 });

    expect(result.totalPages).toBe(3); // ceil(7/3) = 3
  });
});
