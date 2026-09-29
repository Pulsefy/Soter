import {
  CampaignBudgetAlertScheduler,
  DEFAULT_BUDGET_ALERT_THRESHOLD_PERCENT,
  budgetAlertDedupKey,
} from './campaign-budget-alert.scheduler';
import { BudgetService } from '../common/budget/budget.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CampaignBudgetAlertScheduler', () => {
  let scheduler: CampaignBudgetAlertScheduler;
  let prisma: {
    campaign: { findMany: jest.Mock };
    notificationOutbox: { findFirst: jest.Mock; update: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let budgetService: { getCampaignBudgetUsage: jest.Mock };
  let notificationsService: { sendEmail: jest.Mock };

  const originalThresholdEnv = process.env.CAMPAIGN_BUDGET_ALERT_THRESHOLD_PERCENT;

  beforeEach(() => {
    delete process.env.CAMPAIGN_BUDGET_ALERT_THRESHOLD_PERCENT;

    prisma = {
      campaign: { findMany: jest.fn().mockResolvedValue([]) },
      notificationOutbox: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    budgetService = { getCampaignBudgetUsage: jest.fn() };
    notificationsService = {
      sendEmail: jest
        .fn()
        .mockResolvedValue({ outboxId: 'outbox-1', jobId: 'job-1' }),
    };

    scheduler = new CampaignBudgetAlertScheduler(
      prisma as unknown as PrismaService,
      budgetService as unknown as BudgetService,
      notificationsService as unknown as NotificationsService,
    );
  });

  afterAll(() => {
    if (originalThresholdEnv === undefined) {
      delete process.env.CAMPAIGN_BUDGET_ALERT_THRESHOLD_PERCENT;
    } else {
      process.env.CAMPAIGN_BUDGET_ALERT_THRESHOLD_PERCENT = originalThresholdEnv;
    }
  });

  const activeCampaign = (overrides: Record<string, unknown> = {}) => ({
    id: 'campaign-1',
    name: 'Flood Relief',
    budget: 1000,
    orgId: 'org-1',
    ngoId: null,
    ...overrides,
  });

  describe('resolveThresholdPercent', () => {
    it('defaults to 80% when no env var is set', () => {
      expect(scheduler.resolveThresholdPercent()).toBe(
        DEFAULT_BUDGET_ALERT_THRESHOLD_PERCENT,
      );
      expect(scheduler.resolveThresholdPercent()).toBe(80);
    });

    it.each(['abc', '0', '-5', '150'])(
      'falls back to 80% for invalid value %s',
      value => {
        process.env.CAMPAIGN_BUDGET_ALERT_THRESHOLD_PERCENT = value;
        expect(scheduler.resolveThresholdPercent()).toBe(80);
      },
    );

    it('honors a valid configured threshold', () => {
      process.env.CAMPAIGN_BUDGET_ALERT_THRESHOLD_PERCENT = '50';
      expect(scheduler.resolveThresholdPercent()).toBe(50);
    });
  });

  describe('checkBudgetThresholds — threshold crossing', () => {
    it('notifies org admins when consumption crosses the threshold', async () => {
      prisma.campaign.findMany.mockResolvedValue([activeCampaign()]);
      // locked 700 + disbursed 150 = 850 of 1000 => 85% >= 80%
      budgetService.getCampaignBudgetUsage.mockResolvedValue({
        locked: 700,
        disbursed: 150,
      });
      prisma.user.findMany.mockResolvedValue([
        { email: 'admin-one@example.com' },
        { email: 'admin-two@example.com' },
      ]);

      await scheduler.checkBudgetThresholds();

      expect(prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        }),
      );
      expect(budgetService.getCampaignBudgetUsage).toHaveBeenCalledWith(
        'campaign-1',
      );
      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(2);
      expect(notificationsService.sendEmail).toHaveBeenCalledWith(
        'admin-one@example.com',
        expect.stringContaining('85%'),
        expect.stringContaining('Flood Relief'),
      );
      // Each outbox record is tagged with the dedup key for future runs.
      expect(prisma.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: 'outbox-1' },
        data: {
          metadata: expect.stringContaining(
            budgetAlertDedupKey('campaign-1', 80),
          ),
        },
      });
      const saved = JSON.parse(
        prisma.notificationOutbox.update.mock.calls[0][0].data.metadata,
      );
      expect(saved).toEqual({
        budgetAlertKey: budgetAlertDedupKey('campaign-1', 80),
        campaignId: 'campaign-1',
        thresholdPercent: 80,
      });
    });

    it('does not notify campaigns below the threshold', async () => {
      prisma.campaign.findMany.mockResolvedValue([activeCampaign()]);
      // 500 of 1000 => 50% < 80%
      budgetService.getCampaignBudgetUsage.mockResolvedValue({
        locked: 500,
        disbursed: 0,
      });

      await scheduler.checkBudgetThresholds();

      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('honors a configured threshold override when crossing', async () => {
      process.env.CAMPAIGN_BUDGET_ALERT_THRESHOLD_PERCENT = '50';
      prisma.campaign.findMany.mockResolvedValue([activeCampaign()]);
      // 600 of 1000 => 60% >= 50% (but below the 80% default)
      budgetService.getCampaignBudgetUsage.mockResolvedValue({
        locked: 600,
        disbursed: 0,
      });
      prisma.user.findMany.mockResolvedValue([{ email: 'admin@example.com' }]);

      await scheduler.checkBudgetThresholds();

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
      expect(prisma.notificationOutbox.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.stringContaining(
              budgetAlertDedupKey('campaign-1', 50),
            ),
          }),
        }),
      );
    });

    it('skips campaigns with a zero or negative budget', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        activeCampaign({ budget: 0 }),
      ]);

      await scheduler.checkBudgetThresholds();

      expect(budgetService.getCampaignBudgetUsage).not.toHaveBeenCalled();
      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
    });

    it('does not notify when the campaign has no org to alert', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        activeCampaign({ orgId: null, ngoId: null }),
      ]);
      budgetService.getCampaignBudgetUsage.mockResolvedValue({
        locked: 900,
        disbursed: 0,
      });

      await scheduler.checkBudgetThresholds();

      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
    });

    it('does not notify when the org has no admin users', async () => {
      prisma.campaign.findMany.mockResolvedValue([activeCampaign()]);
      budgetService.getCampaignBudgetUsage.mockResolvedValue({
        locked: 900,
        disbursed: 0,
      });
      prisma.user.findMany.mockResolvedValue([]);

      await scheduler.checkBudgetThresholds();

      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
    });

    it('a failing campaign does not prevent checking the others', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        activeCampaign({ id: 'campaign-broken' }),
        activeCampaign({ id: 'campaign-ok', name: 'Ok Campaign' }),
      ]);
      budgetService.getCampaignBudgetUsage
        .mockRejectedValueOnce(new Error('ledger exploded'))
        .mockResolvedValueOnce({ locked: 950, disbursed: 0 });
      prisma.user.findMany.mockResolvedValue([{ email: 'admin@example.com' }]);

      await scheduler.checkBudgetThresholds();

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
      expect(notificationsService.sendEmail).toHaveBeenCalledWith(
        'admin@example.com',
        expect.stringContaining('Ok Campaign'),
        expect.any(String),
      );
    });
  });

  describe('deduplication', () => {
    it('does not re-notify for the same campaign and threshold crossing', async () => {
      prisma.campaign.findMany.mockResolvedValue([activeCampaign()]);
      budgetService.getCampaignBudgetUsage.mockResolvedValue({
        locked: 900,
        disbursed: 0,
      });
      // A prior run already sent the alert for this crossing.
      prisma.notificationOutbox.findFirst.mockResolvedValue({ id: 'outbox-0' });

      await scheduler.checkBudgetThresholds();

      expect(prisma.notificationOutbox.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            metadata: {
              contains: `"budgetAlertKey":"${budgetAlertDedupKey('campaign-1', 80)}"`,
            },
          }),
        }),
      );
      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('sends a new alert when a different threshold is crossed', async () => {
      process.env.CAMPAIGN_BUDGET_ALERT_THRESHOLD_PERCENT = '80';
      prisma.campaign.findMany.mockResolvedValue([activeCampaign()]);
      budgetService.getCampaignBudgetUsage.mockResolvedValue({
        locked: 900,
        disbursed: 0,
      });

      // A prior run alerted at the 50% threshold; the stored metadata only
      // carries the 50% dedup key, so it must not suppress the 80% alert.
      const storedMetadata: string[] = [
        JSON.stringify({
          budgetAlertKey: budgetAlertDedupKey('campaign-1', 50),
          campaignId: 'campaign-1',
          thresholdPercent: 50,
        }),
      ];
      prisma.notificationOutbox.findFirst.mockImplementation(({ where }) => {
        const contains = where.metadata.contains as string;
        const hit = storedMetadata.some(metadata => metadata.includes(contains));
        return Promise.resolve(hit ? { id: 'outbox-x' } : null);
      });
      prisma.user.findMany.mockResolvedValue([{ email: 'admin@example.com' }]);
      prisma.notificationOutbox.update.mockImplementation(({ data }) => {
        storedMetadata.push(data.metadata);
        return Promise.resolve({});
      });

      await scheduler.checkBudgetThresholds();

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
      const saved = JSON.parse(
        prisma.notificationOutbox.update.mock.calls[0][0].data.metadata,
      );
      expect(saved.thresholdPercent).toBe(80);
      expect(saved.budgetAlertKey).toBe(budgetAlertDedupKey('campaign-1', 80));
    });
  });

  describe('handleBudgetThresholdCron', () => {
    it('swallows errors from the check so the cron never throws', async () => {
      jest
        .spyOn(scheduler, 'checkBudgetThresholds')
        .mockRejectedValue(new Error('db down'));

      await expect(scheduler.handleBudgetThresholdCron()).resolves.toBeUndefined();
    });

    it('runs the check on each tick', async () => {
      const spy = jest
        .spyOn(scheduler, 'checkBudgetThresholds')
        .mockResolvedValue(undefined);

      await scheduler.handleBudgetThresholdCron();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
