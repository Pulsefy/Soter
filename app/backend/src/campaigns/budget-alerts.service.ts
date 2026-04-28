import { Injectable, Logger } from '@nestjs/common';
import { Campaign } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

interface CampaignWithAlerts extends Campaign {
  budgetThresholdAlerts: Array<{ threshold: number; alertedAt: Date }>;
  org?: { id: string; name?: string } | null;
}

@Injectable()
export class BudgetAlertsService {
  private readonly logger = new Logger(BudgetAlertsService.name);

  // Configurable thresholds - could be made configurable per campaign/org in the future
  private readonly THRESHOLDS = [0.5, 0.8, 0.95]; // 50%, 80%, 95%

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Check budget utilization for a campaign and trigger alerts if thresholds are crossed.
   * Should be called whenever the locked balance changes (claim approved/cancelled).
   */
  async checkThresholds(campaignId: string): Promise<void> {
    try {
      // Get campaign with current budget utilization
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
          budgetThresholdAlerts: true,
          org: true,
        },
      });

      if (!campaign || !campaign.budget) {
        return; // No budget to monitor
      }

      // Calculate current utilization
      const lockedBalance = await this.getLockedBalance(campaignId);
      const utilization = lockedBalance / campaign.budget;

      this.logger.log(
        `Campaign ${campaignId} budget utilization: ${(utilization * 100).toFixed(1)}%`,
      );

      // Check each threshold
      for (const threshold of this.THRESHOLDS) {
        if (utilization >= threshold) {
          await this.alertIfNotAlreadySent(campaign, threshold, utilization);
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to check budget thresholds for campaign ${campaignId}`,
        error,
      );
    }
  }

  /**
   * Get the current locked balance for a campaign.
   * The locked balance is the sum of all 'lock' events minus 'unlock' events.
   */
  private async getLockedBalance(campaignId: string): Promise<number> {
    const result = await this.prisma.balanceLedger.aggregate({
      where: { campaignId },
      _sum: { amount: true },
    });

    return result._sum.amount ?? 0;
  }

  /**
   * Send an alert for a threshold if it hasn't been sent before.
   */
  private async alertIfNotAlreadySent(
    campaign: CampaignWithAlerts,
    threshold: number,
    utilization: number,
  ): Promise<void> {
    // Check if we've already alerted for this threshold
    const existingAlert = campaign.budgetThresholdAlerts.find(
      (alert) => alert.threshold === threshold,
    );

    if (existingAlert) {
      return; // Already alerted
    }

    // Send alert
    await this.sendBudgetAlert(campaign, threshold, utilization);

    // Record the alert
    await this.prisma.budgetThresholdAlert.create({
      data: {
        campaignId: campaign.id,
        threshold,
      },
    });

    this.logger.log(
      `Budget threshold alert sent for campaign ${campaign.name} at ${(threshold * 100).toFixed(0)}% utilization`,
    );
  }

  /**
   * Send the actual budget alert notification.
   */
  private async sendBudgetAlert(
    campaign: CampaignWithAlerts,
    threshold: number,
    utilization: number,
  ): Promise<void> {
    const percentage = (threshold * 100).toFixed(0);
    const currentUsage = (utilization * 100).toFixed(1);

    const subject = `Budget Alert: ${campaign.name} at ${currentUsage}% utilization`;
    const message = `
Campaign: ${campaign.name}
Budget Threshold: ${percentage}%
Current Utilization: ${currentUsage}%
Budget: $${campaign.budget.toLocaleString()}
Locked Amount: $${(campaign.budget * utilization).toLocaleString()}

Please review your campaign budget allocation.
    `.trim();

    // Find recipients - for now, send to org admin or campaign owner
    // In a real implementation, this would be configurable per campaign
    const recipients = await this.getAlertRecipients(campaign);

    for (const recipient of recipients) {
      try {
        await this.notificationsService.sendEmail(
          recipient,
          subject,
          message,
        );
      } catch (error) {
        this.logger.error(
          `Failed to send budget alert to ${recipient}`,
          error,
        );
      }
    }
  }

  /**
   * Get email recipients for budget alerts.
   * For now, returns org admin emails. In production, this would be configurable.
   */
  private async getAlertRecipients(campaign: CampaignWithAlerts): Promise<string[]> {
    if (!campaign.orgId) {
      return []; // No org, no recipients
    }

    // Get org users with admin role
    const orgUsers = await this.prisma.user.findMany({
      where: {
        orgId: campaign.orgId,
        role: 'admin',
      },
    });

    return orgUsers
      .map((user) => user.email)
      .filter((email): email is string => email !== null && email !== undefined);
  }

  /**
   * Reset alerts for a campaign (useful when budget is reconfigured).
   */
  async resetAlerts(campaignId: string): Promise<void> {
    await this.prisma.budgetThresholdAlert.deleteMany({
      where: { campaignId },
    });

    this.logger.log(`Reset budget threshold alerts for campaign ${campaignId}`);
  }
}