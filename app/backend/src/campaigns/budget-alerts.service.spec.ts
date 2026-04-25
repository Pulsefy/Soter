import { Test, TestingModule } from '@nestjs/testing';
import { BudgetAlertsService } from './budget-alerts.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('BudgetAlertsService', () => {
  let service: BudgetAlertsService;
  let prismaService: jest.Mocked<PrismaService>;
  let notificationsService: jest.Mocked<NotificationsService>;

  beforeEach(async () => {
    const mockPrismaService = {
      campaign: {
        findUnique: jest.fn(),
      },
      balanceLedger: {
        aggregate: jest.fn(),
      },
      budgetThresholdAlert: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
    };

    const mockNotificationsService = {
      sendEmail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetAlertsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    service = module.get<BudgetAlertsService>(BudgetAlertsService);
    prismaService = module.get(PrismaService);
    notificationsService = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkThresholds', () => {
    it('should not alert if utilization is below thresholds', async () => {
      // Mock campaign with budget 100, locked balance 20 (20% utilization)
      prismaService.campaign.findUnique.mockResolvedValue({
        id: 'campaign-1',
        budget: 100,
        budgetThresholdAlerts: [],
        orgId: 'org-1',
      } as any);

      prismaService.balanceLedger.aggregate.mockResolvedValue({
        _sum: { amount: 20 },
      } as any);

      await service.checkThresholds('campaign-1');

      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
    });

    it('should alert when threshold is crossed', async () => {
      // Mock campaign with budget 100, locked balance 60 (60% utilization)
      prismaService.campaign.findUnique.mockResolvedValue({
        id: 'campaign-1',
        name: 'Test Campaign',
        budget: 100,
        budgetThresholdAlerts: [],
        orgId: 'org-1',
      } as any);

      prismaService.balanceLedger.aggregate.mockResolvedValue({
        _sum: { amount: 60 },
      } as any);

      prismaService.user.findMany.mockResolvedValue([
        { email: 'admin@example.com' },
      ] as any);

      await service.checkThresholds('campaign-1');

      expect(notificationsService.sendEmail).toHaveBeenCalledWith(
        'admin@example.com',
        'Budget Alert: Test Campaign at 60.0% utilization',
        expect.stringContaining('Current Utilization: 60.0%'),
      );

      expect(prismaService.budgetThresholdAlert.create).toHaveBeenCalledWith({
        data: {
          campaignId: 'campaign-1',
          threshold: 0.5,
        },
      });
    });

    it('should not send duplicate alerts for same threshold', async () => {
      // Mock campaign with existing alert for 50% threshold
      prismaService.campaign.findUnique.mockResolvedValue({
        id: 'campaign-1',
        budget: 100,
        budgetThresholdAlerts: [{ threshold: 0.5 }],
        orgId: 'org-1',
      } as any);

      prismaService.balanceLedger.aggregate.mockResolvedValue({
        _sum: { amount: 60 },
      } as any);

      await service.checkThresholds('campaign-1');

      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
    });
  });
});