import { Test, TestingModule } from '@nestjs/testing';
import { SandboxService } from './sandbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import {
  DEMO_TENANT_SEED,
  DEMO_CAMPAIGN_SEEDS,
  DEMO_CLAIM_SEEDS,
} from './demo-seeds.constants';

describe('SandboxService', () => {
  let service: SandboxService;
  let _prisma: PrismaService;
  let _loggerService: LoggerService;
  let _configService: ConfigService;

  const mockPrisma = {
    organization: {
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    campaign: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    claim: {
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(async callback => {
      // Mock transaction to directly call the callback with a mock client
      return await callback(mockPrisma);
    }),
  };

  const mockLoggerService = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SandboxService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SandboxService>(SandboxService);
    _prisma = module.get<PrismaService>(PrismaService);
    _loggerService = module.get<LoggerService>(LoggerService);
    _configService = module.get<ConfigService>(ConfigService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resetDemoState', () => {
    it('should throw ForbiddenException if NODE_ENV is production', async () => {
      mockConfigService.get.mockReturnValue('production');
      await expect(service.resetDemoState()).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockLoggerService.warn).toHaveBeenCalledWith(
        'Attempted demo seed reset in disallowed environment: production',
        SandboxService.name,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException if NODE_ENV is staging', async () => {
      mockConfigService.get.mockReturnValue('staging');
      await expect(service.resetDemoState()).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockLoggerService.warn).toHaveBeenCalledWith(
        'Attempted demo seed reset in disallowed environment: staging',
        SandboxService.name,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should proceed if NODE_ENV is development', async () => {
      mockConfigService.get.mockReturnValue('development');
      mockPrisma.campaign.findMany.mockResolvedValue([]);
      mockPrisma.organization.upsert.mockResolvedValue({
        id: DEMO_TENANT_SEED.ngoId,
        name: DEMO_TENANT_SEED.name,
      });
      mockPrisma.campaign.upsert.mockResolvedValue({
        id: 'campaign-id',
        name: DEMO_CAMPAIGN_SEEDS[0].name,
      });
      await service.resetDemoState();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        'Starting demo seed reset...',
        SandboxService.name,
      );
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        'Demo seed reset completed.',
        SandboxService.name,
      );
    });

    it('should proceed if NODE_ENV is test', async () => {
      mockConfigService.get.mockReturnValue('test');
      mockPrisma.campaign.findMany.mockResolvedValue([]);
      mockPrisma.organization.upsert.mockResolvedValue({
        id: DEMO_TENANT_SEED.ngoId,
        name: DEMO_TENANT_SEED.name,
      });
      mockPrisma.campaign.upsert.mockResolvedValue({
        id: 'campaign-id',
        name: DEMO_CAMPAIGN_SEEDS[0].name,
      });
      await service.resetDemoState();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should proceed if NODE_ENV is sandbox', async () => {
      mockConfigService.get.mockReturnValue('sandbox');
      mockPrisma.campaign.findMany.mockResolvedValue([]);
      mockPrisma.organization.upsert.mockResolvedValue({
        id: DEMO_TENANT_SEED.ngoId,
        name: DEMO_TENANT_SEED.name,
      });
      mockPrisma.campaign.upsert.mockResolvedValue({
        id: 'campaign-id',
        name: DEMO_CAMPAIGN_SEEDS[0].name,
      });
      await service.resetDemoState();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should delete existing demo data in correct order and then re-seed', async () => {
      mockConfigService.get.mockReturnValue('development');

      const mockCampaigns = DEMO_CAMPAIGN_SEEDS.map((seed, index) => ({
        id: `campaign-id-${index}`,
        name: seed.name,
      }));
      mockPrisma.campaign.findMany.mockResolvedValue(mockCampaigns);

      // Mock upsert operations to return the created/updated object
      mockPrisma.organization.upsert.mockResolvedValue({
        id: DEMO_TENANT_SEED.ngoId,
      });
      mockPrisma.campaign.upsert.mockImplementation(args =>
        Promise.resolve({ id: 'new-campaign-id', ...args.create }),
      );
      mockPrisma.claim.upsert.mockResolvedValue({});

      await service.resetDemoState();

      // Verify delete order
      expect(mockPrisma.claim.deleteMany).toHaveBeenCalledWith({
        where: { campaignId: { in: mockCampaigns.map(c => c.id) } },
      });
      expect(mockPrisma.campaign.deleteMany).toHaveBeenCalledWith({
        where: { ngoId: DEMO_TENANT_SEED.ngoId },
      });
      expect(mockPrisma.organization.deleteMany).toHaveBeenCalledWith({
        where: { id: DEMO_TENANT_SEED.ngoId },
      });

      // Verify seeding calls
      expect(mockPrisma.organization.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: DEMO_TENANT_SEED.ngoId },
          create: expect.objectContaining({ id: DEMO_TENANT_SEED.ngoId }),
        }),
      );
      expect(mockPrisma.campaign.upsert).toHaveBeenCalledTimes(
        DEMO_CAMPAIGN_SEEDS.length,
      );
      expect(mockPrisma.claim.upsert).toHaveBeenCalledTimes(
        DEMO_CLAIM_SEEDS.length,
      );

      // Verify logging
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        'Starting demo seed reset...',
        SandboxService.name,
      );
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        `Deleted ${mockCampaigns.length} demo claims.`,
        SandboxService.name,
      );
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        `Deleted demo campaigns for NGO: ${DEMO_TENANT_SEED.ngoId}.`,
        SandboxService.name,
      );
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        `Deleted demo NGO: ${DEMO_TENANT_SEED.ngoId}.`,
        SandboxService.name,
      );
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        'Seeding demo tenant...',
        SandboxService.name,
      );
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        'Seeding demo campaigns...',
        SandboxService.name,
      );
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        'Seeding demo claims...',
        SandboxService.name,
      );
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        'Demo seed reset completed.',
        SandboxService.name,
      );
    });
  });
});
