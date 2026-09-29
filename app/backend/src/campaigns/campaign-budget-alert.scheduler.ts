import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppRole, CampaignStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetService } from '../common/budget/budget.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Default alert threshold: alert once 80% of the campaign budget is consumed. */
export const DEFAULT_BUDGET_ALERT_THRESHOLD_PERCENT = 80;

/**
 * Identifies the budget-threshold alert for a campaign at a given threshold in
 * the outbox record's `metadata` column, so repeat runs of the scheduled check
 * can deduplicate alerts for the same threshold crossing (issue #1187).
 */
export function budgetAlertDedupKey(
  campaignId: string,
  thresholdPercent: number,
): string {
  return `budget-threshold-alert:v1:${campaignId}:${thresholdPercent}`;
}

/**
 * Periodically alerts organization admins when a campaign's budget consumption
 * (locked + disbursed, per BalanceLedger) crosses a configurable percentage of
 * its budget (issue #1187).
 *
 * The check runs on a schedule — not only at claim-creation time — so a
 * campaign without active claims is still monitored. Alerts are deduplicated
 * per (campaign, threshold): once an alert has been sent for a crossing, the
 * same threshold does not notify again.
 */
@Injectable()
export class CampaignBudgetAlertScheduler {
  private readonly logger = new Logger(CampaignBudgetAlertScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budgetService: BudgetService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Alert threshold as a percentage of budget. Configurable via the
   * `CAMPAIGN_BUDGET_ALERT_THRESHOLD_PERCENT` env var; invalid values fall
   * back to the 80% default.
   */
  resolveThresholdPercent(): number {
    const raw = process.env.CAMPAIGN_BUDGET_ALERT_THRESHOLD_PERCENT;
    const parsed = raw !== undefined ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
      return DEFAULT_BUDGET_ALERT_THRESHOLD_PERCENT;
    }
    return Math.floor(parsed);
  }

  @Cron(CronExpression.EVERY_HOUR, {
    name: 'campaign-budget-threshold-alerts',
  })
  async handleBudgetThresholdCron(): Promise<void> {
    try {
      await this.checkBudgetThresholds();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Budget threshold alert check failed: ${message}`);
    }
  }

  /**
   * Checks every active campaign's budget consumption and emails org admins
   * for campaigns that have crossed the configured threshold. Errors on one
   * campaign are logged and do not stop the remaining checks.
   */
  async checkBudgetThresholds(): Promise<void> {
    const thresholdPercent = this.resolveThresholdPercent();

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.active,
        deletedAt: null,
        archivedAt: null,
      },
      select: { id: true, name: true, budget: true, orgId: true, ngoId: true },
    });

    for (const campaign of campaigns) {
      try {
        await this.checkCampaign(campaign, thresholdPercent);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Budget threshold check failed for campaign ${campaign.id}: ${message}`,
        );
      }
    }
  }

  private async checkCampaign(
    campaign: {
      id: string;
      name: string;
      budget: number;
      orgId: string | null;
      ngoId: string | null;
    },
    thresholdPercent: number,
  ): Promise<void> {
    if (campaign.budget <= 0) return;

    const usage = await this.budgetService.getCampaignBudgetUsage(campaign.id);
    const consumed = usage.locked + usage.disbursed;
    const consumedPercent = (consumed / campaign.budget) * 100;
    if (consumedPercent < thresholdPercent) return;

    const dedupKey = budgetAlertDedupKey(campaign.id, thresholdPercent);
    const existingAlert = await this.prisma.notificationOutbox.findFirst({
      where: { metadata: { contains: `"budgetAlertKey":"${dedupKey}"` } },
      select: { id: true },
    });
    if (existingAlert) return;

    const orgId = campaign.orgId ?? campaign.ngoId;
    if (!orgId) {
      this.logger.warn(
        `Campaign ${campaign.id} crossed the ${thresholdPercent}% budget threshold but has no org to notify`,
      );
      return;
    }

    const admins = await this.prisma.user.findMany({
      where: { orgId, role: AppRole.admin },
      select: { email: true },
    });
    if (admins.length === 0) {
      this.logger.warn(
        `Campaign ${campaign.id} crossed the ${thresholdPercent}% budget threshold but org ${orgId} has no admin users`,
      );
      return;
    }

    const remaining = Math.max(0, campaign.budget - consumed);
    const subject = `Campaign budget alert: "${campaign.name}" has consumed ${consumedPercent.toFixed(0)}% of its budget`;
    const message =
      `Campaign "${campaign.name}" (${campaign.id}) has consumed ${consumedPercent.toFixed(1)}% of its budget. ` +
      `Consumed: ${consumed.toFixed(2)}, budget: ${campaign.budget.toFixed(2)}, remaining: ${remaining.toFixed(2)}. ` +
      `Please plan a top-up before claims start failing budget checks.`;

    for (const admin of admins) {
      const { outboxId } = await this.notificationsService.sendEmail(
        admin.email,
        subject,
        message,
      );
      // Tag the outbox record so future runs deduplicate this threshold
      // crossing. Written per record (not at creation time) because the
      // notification flow owns the initial outbox insert.
      await this.prisma.notificationOutbox.update({
        where: { id: outboxId },
        data: {
          metadata: JSON.stringify({
            budgetAlertKey: dedupKey,
            campaignId: campaign.id,
            thresholdPercent,
          }),
        },
      });
    }

    this.logger.log(
      `Budget threshold alert sent for campaign ${campaign.id} (${consumedPercent.toFixed(1)}% consumed, threshold ${thresholdPercent}%)`,
    );
  }
}
