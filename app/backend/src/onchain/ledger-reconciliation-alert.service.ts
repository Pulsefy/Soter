import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  LedgerBalanceDiscrepancy,
  LedgerBalanceReconciliationReport,
  LedgerReconciliationSeverity,
} from './ledger-reconciliation.service';

/** Alert once a run finds at least this many discrepancies. */
export const DEFAULT_RECONCILIATION_ALERT_MIN_DISCREPANCIES = 1;

/** Alert once a run finds at least one discrepancy at this severity. */
export const DEFAULT_RECONCILIATION_ALERT_MIN_SEVERITY: LedgerReconciliationSeverity =
  'high';

/** Where operators read the full report behind an alert. */
export const DEFAULT_RECONCILIATION_ALERT_REPORT_URL =
  '/admin/ledger/reconcile/balances/latest';

const SEVERITY_RANK: Record<LedgerReconciliationSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Identifies the alert for a given set of discrepancies in the outbox record's
 * `metadata` column. Derived from the discrepancies themselves, so a scheduled
 * re-run that finds the *same* unresolved drift deduplicates, while a new or
 * worsened discrepancy produces a new key and re-alerts.
 */
export function reconciliationAlertDedupKey(
  discrepancies: LedgerBalanceDiscrepancy[],
): string {
  const fingerprints = discrepancies
    .map(d => `${d.campaignId}:${d.tokenAddress}:${d.severity}`)
    .sort();
  const hash = createHash('sha256')
    .update(fingerprints.join('|'))
    .digest('hex')
    .slice(0, 16);
  return `ledger-reconciliation-alert:v1:${hash}`;
}

/**
 * Proactively notifies operators when a ledger reconciliation run finds
 * discrepancies beyond a configurable count/severity threshold, instead of
 * leaving them to check the report themselves.
 *
 * Alerts are deduplicated per discrepancy set: repeated scheduled runs against
 * the same unresolved findings do not notify again until the findings change.
 */
@Injectable()
export class LedgerReconciliationAlertService {
  private readonly logger = new Logger(LedgerReconciliationAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async notifyIfThresholdExceeded(
    report: LedgerBalanceReconciliationReport,
  ): Promise<void> {
    if (report.discrepancies.length === 0) {
      return;
    }

    const minCount = this.resolveMinDiscrepancies();
    const minSeverity = this.resolveMinSeverity();
    if (!this.exceedsThreshold(report, minCount, minSeverity)) {
      return;
    }

    const recipients = this.resolveRecipients();
    if (recipients.length === 0) {
      this.logger.warn(
        `Ledger reconciliation ${report.runId} breached the alert threshold but LEDGER_RECONCILIATION_ALERT_RECIPIENTS is not set`,
      );
      return;
    }

    const dedupKey = reconciliationAlertDedupKey(report.discrepancies);
    const existing = await this.prisma.notificationOutbox.findFirst({
      where: {
        metadata: { contains: `"reconciliationAlertKey":"${dedupKey}"` },
      },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(
        `Ledger reconciliation ${report.runId} already alerted for this discrepancy set, skipping`,
      );
      return;
    }

    const { subject, message } = this.buildNotification(report);

    for (const recipient of recipients) {
      const { outboxId } = await this.notificationsService.sendEmail(
        recipient,
        subject,
        message,
      );
      // Tag the outbox record so later runs deduplicate this discrepancy set.
      await this.prisma.notificationOutbox.update({
        where: { id: outboxId },
        data: {
          metadata: JSON.stringify({
            reconciliationAlertKey: dedupKey,
            runId: report.runId,
            totalDiscrepancies: report.summary.totalDiscrepancies,
            bySeverity: report.summary.bySeverity,
          }),
        },
      });
    }

    this.logger.log(
      `Ledger reconciliation alert sent for ${report.runId} to ${recipients.length} recipient(s)`,
    );
  }

  private exceedsThreshold(
    report: LedgerBalanceReconciliationReport,
    minCount: number,
    minSeverity: LedgerReconciliationSeverity,
  ): boolean {
    if (report.summary.totalDiscrepancies >= minCount) {
      return true;
    }
    const worst = report.discrepancies.reduce<LedgerReconciliationSeverity>(
      (acc, d) =>
        SEVERITY_RANK[d.severity] > SEVERITY_RANK[acc] ? d.severity : acc,
      'low',
    );
    return SEVERITY_RANK[worst] >= SEVERITY_RANK[minSeverity];
  }

  private buildNotification(report: LedgerBalanceReconciliationReport): {
    subject: string;
    message: string;
  } {
    const { bySeverity, totalDiscrepancies, byCampaign } = report.summary;
    const plural = totalDiscrepancies === 1 ? 'y' : 'ies';

    const byCampaignSummary = Object.entries(byCampaign)
      .sort((a, b) => b[1] - a[1])
      .map(([campaignId, count]) => `${campaignId}=${count}`)
      .join(', ');

    const shown = report.discrepancies.slice(0, 5);
    const findings = shown
      .map(
        d =>
          `- [${d.severity}] campaign=${d.campaignId} token=${d.tokenAddress} ` +
          `expected(onchain)=${d.expected} actual(ledger)=${d.actual} difference=${d.difference}`,
      )
      .join('\n');

    const subject = `Ledger reconciliation alert: ${totalDiscrepancies} discrepanc${plural} found`;

    const message =
      `Ledger reconciliation run ${report.runId} (${report.source}) found ` +
      `${totalDiscrepancies} discrepanc${plural} across ${report.pairsChecked} campaign/token pair(s).\n\n` +
      `By severity: high=${bySeverity.high}, medium=${bySeverity.medium}, low=${bySeverity.low}\n` +
      `By campaign: ${byCampaignSummary || 'n/a'}\n\n` +
      `Findings${report.discrepancies.length > shown.length ? ' (first 5)' : ''}:\n${findings}\n\n` +
      `Full report: ${this.resolveReportUrl()}`;

    return { subject, message };
  }

  private resolveRecipients(): string[] {
    const raw: unknown = this.configService.get(
      'LEDGER_RECONCILIATION_ALERT_RECIPIENTS',
    );
    if (typeof raw !== 'string') {
      return [];
    }
    return raw
      .split(',')
      .map(recipient => recipient.trim())
      .filter(recipient => recipient.length > 0);
  }

  private resolveMinDiscrepancies(): number {
    const raw: unknown = this.configService.get(
      'LEDGER_RECONCILIATION_ALERT_MIN_DISCREPANCIES',
    );
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 1
      ? Math.floor(parsed)
      : DEFAULT_RECONCILIATION_ALERT_MIN_DISCREPANCIES;
  }

  private resolveMinSeverity(): LedgerReconciliationSeverity {
    const raw: unknown = this.configService.get(
      'LEDGER_RECONCILIATION_ALERT_MIN_SEVERITY',
    );
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return value === 'low' || value === 'medium' || value === 'high'
      ? value
      : DEFAULT_RECONCILIATION_ALERT_MIN_SEVERITY;
  }

  private resolveReportUrl(): string {
    const raw: unknown = this.configService.get(
      'LEDGER_RECONCILIATION_ALERT_REPORT_URL',
    );
    return typeof raw === 'string' && raw.trim() !== ''
      ? raw.trim()
      : DEFAULT_RECONCILIATION_ALERT_REPORT_URL;
  }
}
