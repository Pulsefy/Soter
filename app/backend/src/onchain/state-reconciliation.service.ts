import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ONCHAIN_ADAPTER_TOKEN, OnchainAdapter } from './onchain.adapter';

@Injectable()
export class StateReconciliationService {
  private readonly logger = new Logger(StateReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runPeriodicReconciliation() {
    this.logger.log('Running periodic state reconciliation...');
    try {
      const result = await this.reconcileAll();
      this.logger.log(
        `Periodic reconciliation complete. Packages drifted: ${result.packagesDrifted}, Totals drifted: ${result.totalsDrifted}`,
      );
    } catch (error) {
      this.logger.error(`Periodic reconciliation failed: ${error.message}`);
    }
  }

  async reconcileAll() {
    const packagesDrift = await this.reconcilePackages();
    const totalsDrift = await this.reconcileLockedTotals();

    return {
      timestamp: new Date(),
      packagesChecked: packagesDrift.checked,
      packagesDrifted: packagesDrift.drifted,
      totalsChecked: totalsDrift.checked,
      totalsDrifted: totalsDrift.drifted,
    };
  }

  private async reconcilePackages() {
    const packages = await this.prisma.aidPackage.findMany({
      where: { status: { not: 'draft' } },
    });

    let drifted = 0;
    for (const pkg of packages) {
      try {
        const onChainPkg = await this.onchainAdapter.getAidPackage({
          packageId: pkg.id,
        });
        if (!onChainPkg || !onChainPkg.package) continue;

        const oc = onChainPkg.package;

        // Status drift
        if (oc.status.toLowerCase() !== pkg.status.toLowerCase()) {
          await this.logDrift(
            'AidPackage',
            pkg.id,
            'status',
            oc.status,
            pkg.status,
          );
          drifted++;
        }

        // Amount drift
        const ocAmount = parseFloat(oc.amount);
        if (ocAmount !== pkg.totalAmount) {
          await this.logDrift(
            'AidPackage',
            pkg.id,
            'totalAmount',
            oc.amount,
            pkg.totalAmount.toString(),
          );
          drifted++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to reconcile package ${pkg.id}: ${error.message}`,
        );
      }
    }

    return { checked: packages.length, drifted };
  }

  private async reconcileLockedTotals() {
    let drifted = 0;
    let checked = 0;

    try {
      // Reconcile by summing up active/created packages in DB vs global on-chain committed
      // Note: In production, this would likely be filtered by token address
      const onChainAggregates = await this.onchainAdapter.getAidPackageCount({
        token: '',
      });
      const ocCommitted = parseFloat(
        onChainAggregates.aggregates.totalCommitted,
      );

      const dbCommitted = await this.prisma.aidPackage.aggregate({
        _sum: { totalAmount: true },
        where: {
          status: {
            in: ['Created', 'active', 'Created', 'Claimed', 'disbursed'],
          },
        },
      });

      const dbTotal = dbCommitted._sum.totalAmount || 0;
      checked++;

      if (ocCommitted !== dbTotal) {
        await this.logDrift(
          'Global',
          'all',
          'totalCommitted',
          ocCommitted.toString(),
          dbTotal.toString(),
        );
        drifted++;
      }
    } catch (error) {
      this.logger.error(`Failed to reconcile locked totals: ${error.message}`);
    }

    return { checked, drifted };
  }

  private async logDrift(
    entityType: string,
    entityId: string,
    field: string,
    onChainValue: string,
    cachedValue: string,
  ) {
    this.logger.warn(
      `Drift detected in ${entityType} ${entityId} field ${field}: on-chain=${onChainValue}, cached=${cachedValue}`,
    );
    await this.prisma.driftIncidentLog.create({
      data: {
        entityType,
        entityId,
        field,
        onChainValue,
        cachedValue,
      },
    });
  }

  async getDriftLogs(limit: number = 100) {
    return this.prisma.driftIncidentLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }
}
