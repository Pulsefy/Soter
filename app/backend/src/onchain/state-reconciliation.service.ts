import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
  AidPackage as OnchainAidPackage,
} from './onchain.adapter';

/* ------------------------------------------------------------------ */
/*  Public DTOs                                                        */
/* ------------------------------------------------------------------ */

export interface DriftDetail {
  packageId?: string;
  campaignId?: string;
  kind:
    | 'status_mismatch'
    | 'locked_total_mismatch'
    | 'package_missing_onchain'
    | 'package_missing_backend'
    | 'amount_mismatch';
  severity: 'low' | 'medium' | 'high' | 'critical';
  onchainSnapshot: Record<string, unknown>;
  backendSnapshot: Record<string, unknown>;
  description: string;
}

export interface ReconciliationResult {
  triggeredAt: string;
  durationMs: number;
  packagesChecked: number;
  campaignsChecked: number;
  driftsDetected: number;
  drifts: DriftDetail[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Map on-chain status string → the AidPackage.status values used in DB */
function normaliseOnchainStatus(
  raw: OnchainAidPackage['status'],
): string {
  const map: Record<string, string> = {
    Created: 'active',
    Claimed: 'claimed',
    Expired: 'expired',
    Cancelled: 'cancelled',
    Refunded: 'cancelled',
  };
  return map[raw] ?? raw.toLowerCase();
}

function classifyAmountDrift(
  diffPercent: number,
): 'low' | 'medium' | 'high' | 'critical' {
  if (diffPercent > 20) return 'critical';
  if (diffPercent > 10) return 'high';
  if (diffPercent > 5) return 'medium';
  return 'low';
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

@Injectable()
export class StateReconciliationService {
  private readonly logger = new Logger(StateReconciliationService.name);

  /** Guards against overlapping cron runs */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchain: OnchainAdapter,
  ) {}

  /* ================================================================ */
  /*  Periodic reconciliation (cron)                                   */
  /* ================================================================ */

  @Cron(CronExpression.EVERY_30_MINUTES, {
    name: 'state-reconciliation',
  })
  async handleCron(): Promise<void> {
    if (this.running) {
      this.logger.warn('Reconciliation already in progress – skipping');
      return;
    }
    this.running = true;
    try {
      this.logger.log('Starting scheduled state reconciliation');
      const result = await this.reconcile();
      this.logger.log(
        `Scheduled reconciliation finished: ${result.driftsDetected} drift(s) in ${result.durationMs}ms`,
      );
    } catch (err) {
      this.logger.error('Scheduled reconciliation failed', err);
    } finally {
      this.running = false;
    }
  }

  /* ================================================================ */
  /*  On-demand reconciliation                                         */
  /* ================================================================ */

  /**
   * Run a full reconciliation pass.
   * Optionally scope to a single campaignId.
   */
  async reconcile(campaignId?: string): Promise<ReconciliationResult> {
    const startedAt = Date.now();
    const drifts: DriftDetail[] = [];

    // ---- 1. Package-level status reconciliation ----
    const { drifts: packageDrifts, checked: packagesChecked } =
      await this.reconcilePackageStatuses(campaignId);
    drifts.push(...packageDrifts);

    // ---- 2. Campaign locked-totals reconciliation ----
    const { drifts: totalDrifts, checked: campaignsChecked } =
      await this.reconcileLockedTotals(campaignId);
    drifts.push(...totalDrifts);

    // ---- 3. Persist drift incidents ----
    if (drifts.length > 0) {
      await this.persistDrifts(drifts);
    }

    const durationMs = Date.now() - startedAt;

    return {
      triggeredAt: new Date(startedAt).toISOString(),
      durationMs,
      packagesChecked,
      campaignsChecked,
      driftsDetected: drifts.length,
      drifts,
    };
  }

  /* ================================================================ */
  /*  Package status checks                                            */
  /* ================================================================ */

  private async reconcilePackageStatuses(
    campaignId?: string,
  ): Promise<{ drifts: DriftDetail[]; checked: number }> {
    const drifts: DriftDetail[] = [];

    const dbPackages = await this.prisma.aidPackage.findMany({
      where: {
        ...(campaignId ? { campaignId } : {}),
      },
    });

    for (const pkg of dbPackages) {
      try {
        const onchainResult = await this.onchain.getAidPackage({
          packageId: pkg.id,
        });
        const onchainPkg = onchainResult.package;
        const onchainStatus = normaliseOnchainStatus(onchainPkg.status);

        // -- Status mismatch --
        if (onchainStatus !== pkg.status) {
          drifts.push({
            packageId: pkg.id,
            campaignId: pkg.campaignId ?? undefined,
            kind: 'status_mismatch',
            severity: 'high',
            onchainSnapshot: {
              status: onchainPkg.status,
              amount: onchainPkg.amount,
              recipient: onchainPkg.recipient,
              expiresAt: onchainPkg.expiresAt,
            },
            backendSnapshot: {
              status: pkg.status,
              totalAmount: pkg.totalAmount,
              claimedAmount: pkg.claimedAmount,
              remainingAmount: pkg.remainingAmount,
            },
            description: `Package ${pkg.id} status mismatch: on-chain="${onchainPkg.status}" vs backend="${pkg.status}"`,
          });
        }

        // -- Amount mismatch --
        const onchainAmount = Number(onchainPkg.amount) / 1e7; // stroops → units
        const backendAmount = pkg.totalAmount;
        if (backendAmount > 0) {
          const diffPct =
            (Math.abs(onchainAmount - backendAmount) / backendAmount) * 100;
          if (diffPct > 1) {
            drifts.push({
              packageId: pkg.id,
              campaignId: pkg.campaignId ?? undefined,
              kind: 'amount_mismatch',
              severity: classifyAmountDrift(diffPct),
              onchainSnapshot: { amount: onchainPkg.amount, units: onchainAmount },
              backendSnapshot: { totalAmount: pkg.totalAmount },
              description: `Package ${pkg.id} amount drift: on-chain=${onchainAmount} vs backend=${backendAmount} (${diffPct.toFixed(2)}%)`,
            });
          }
        }
      } catch {
        // Package not found on-chain → possible missing deployment
        drifts.push({
          packageId: pkg.id,
          campaignId: pkg.campaignId ?? undefined,
          kind: 'package_missing_onchain',
          severity: 'critical',
          onchainSnapshot: { found: false },
          backendSnapshot: {
            status: pkg.status,
            totalAmount: pkg.totalAmount,
            campaignId: pkg.campaignId,
          },
          description: `Package ${pkg.id} exists in backend but not found on-chain`,
        });
      }
    }

    return { drifts, checked: dbPackages.length };
  }

  /* ================================================================ */
  /*  Locked-totals checks                                             */
  /* ================================================================ */

  private async reconcileLockedTotals(
    campaignId?: string,
  ): Promise<{ drifts: DriftDetail[]; checked: number }> {
    const drifts: DriftDetail[] = [];

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        deletedAt: null,
        ...(campaignId ? { id: campaignId } : {}),
      },
    });

    for (const campaign of campaigns) {
      try {
        // Compute backend locked total from BalanceLedger
        const ledgerAgg = await this.prisma.balanceLedger.aggregate({
          where: { campaignId: campaign.id },
          _sum: { amount: true },
        });
        const backendLocked = ledgerAgg._sum.amount ?? 0;

        // Query on-chain aggregates
        // We need a token address; use a config default or campaign metadata
        const tokenAddress = this.resolveTokenAddress(campaign);
        if (!tokenAddress) continue;

        const onchainAgg = await this.onchain.getAidPackageCount({
          token: tokenAddress,
        });

        // totalCommitted = total locked on-chain (in stroops)
        const onchainLocked =
          Number(onchainAgg.aggregates.totalCommitted) / 1e7;

        if (backendLocked > 0) {
          const diffPct =
            (Math.abs(onchainLocked - backendLocked) / backendLocked) * 100;

          if (diffPct > 2) {
            drifts.push({
              campaignId: campaign.id,
              kind: 'locked_total_mismatch',
              severity: classifyAmountDrift(diffPct),
              onchainSnapshot: {
                totalCommitted: onchainAgg.aggregates.totalCommitted,
                totalClaimed: onchainAgg.aggregates.totalClaimed,
                units: onchainLocked,
              },
              backendSnapshot: {
                ledgerSum: backendLocked,
                budget: campaign.budget,
              },
              description: `Campaign ${campaign.id} locked-total drift: on-chain=${onchainLocked} vs backend=${backendLocked} (${diffPct.toFixed(2)}%)`,
            });
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to reconcile locked totals for campaign ${campaign.id}: ${err}`,
        );
      }
    }

    return { drifts, checked: campaigns.length };
  }

  /* ================================================================ */
  /*  Persistence                                                      */
  /* ================================================================ */

  private async persistDrifts(drifts: DriftDetail[]): Promise<void> {
    await this.prisma.driftIncident.createMany({
      data: drifts.map((d) => ({
        kind: d.kind,
        severity: d.severity,
        campaignId: d.campaignId ?? null,
        packageId: d.packageId ?? null,
        onchainSnapshot: d.onchainSnapshot,
        backendSnapshot: d.backendSnapshot,
        description: d.description,
      })),
    });
    this.logger.log(`Persisted ${drifts.length} drift incident(s)`);
  }

  /* ================================================================ */
  /*  Query helpers for admin endpoints                                */
  /* ================================================================ */

  async getDriftHistory(opts?: {
    campaignId?: string;
    kind?: string;
    severity?: string;
    resolution?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (opts?.campaignId) where.campaignId = opts.campaignId;
    if (opts?.kind) where.kind = opts.kind;
    if (opts?.severity) where.severity = opts.severity;
    if (opts?.resolution) where.resolution = opts.resolution;

    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.driftIncident.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.driftIncident.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async resolveDrift(
    incidentId: string,
    resolvedBy: string,
    resolutionNotes?: string,
  ) {
    return this.prisma.driftIncident.update({
      where: { id: incidentId },
      data: {
        resolution: 'manually_resolved',
        resolvedBy,
        resolvedAt: new Date(),
        resolutionNotes,
      },
    });
  }

  /* ------------------------------------------------------------------ */

  private resolveTokenAddress(campaign: {
    metadata?: unknown;
  }): string | null {
    const meta = campaign.metadata as Record<string, unknown> | null;
    const addr =
      meta?.['tokenAddress'] ?? process.env['DEFAULT_TOKEN_ADDRESS'];
    return typeof addr === 'string' ? addr : null;
  }
}
