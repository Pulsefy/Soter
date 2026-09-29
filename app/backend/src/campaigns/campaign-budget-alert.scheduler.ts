import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BudgetService } from '../common/budget/budget.service';

@Injectable()
export class CampaignBudgetAlertScheduler {
  private readonly logger = new Logger(CampaignBudgetAlertScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly budgetService: BudgetService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.log('Running scheduled campaign budget threshold checks...');
    try {
      await this.checkCampaignBudgetThresholds();
    } catch (error) {
      this.logger.error(
        'Error running campaign budget threshold checks',
        error?.stack || error,
      );
    }
  }

  async checkCampaignBudgetThresholds() {
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        deletedAt: null,
        archivedAt: null,
        status: 'active',
      },
    });

    for (const campaign of campaigns) {
      try {
        const usage = await this.budgetService.getCampaignBudgetUsage(
          campaign.id,
        );
        if (campaign.budget <= 0) continue;

        const percentConsumed = (usage.disbursed / campaign.budget) * 100;
        const threshold = (campaign as any).budgetThresholdPercent ?? 80;

        if (percentConsumed >= threshold) {
          const existingAlert = await this.prisma.auditLog.findFirst({
            where: {
              action: 'CAMPAIGN_BUDGET_THRESHOLD_ALERT',
              targetId: campaign.id,
              metadata: {
                path: ['threshold'],
                equals: threshold,
              },
            },
          });

          if (!existingAlert) {
            await this.notificationsService.sendEmail(
              campaign.orgId
                ? `admin@org-${campaign.orgId}.local`
                : 'admin@soter.local',
              `Campaign Budget Alert: ${campaign.name} has reached ${percentConsumed.toFixed(1)}% budget consumption`,
              `Campaign "${campaign.name}" (ID: ${campaign.id}) has consumed ${percentConsumed.toFixed(1)}% of its budget (${usage.disbursed} / ${campaign.budget}). Configured threshold is ${threshold}%.`,
            );

            await this.prisma.auditLog.create({
              data: {
                action: 'CAMPAIGN_BUDGET_THRESHOLD_ALERT',
                actorId: 'system-scheduler',
                targetType: 'campaign',
                targetId: campaign.id,
                metadata: {
                  threshold,
                  percentConsumed,
                  disbursed: usage.disbursed,
                  budget: campaign.budget,
                },
              } as any,
            });

            this.logger.log(
              `Triggered budget threshold alert for campaign ${campaign.id} at ${percentConsumed.toFixed(1)}% (threshold: ${threshold}%)`,
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `Failed checking budget for campaign ${campaign.id}`,
          err?.stack || err,
        );
      }
    }
  }
}
