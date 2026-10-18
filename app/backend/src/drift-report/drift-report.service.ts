import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../cache/redis.service';
import { DeploymentMetadataService } from '../deployment-metadata/deployment-metadata.service';
import { ContractReadServiceImpl } from '../onchain/contract-read.service';

export interface DriftReport {
  generatedAt: Date;
  configMismatches: ConfigMismatch[];
  missingDeployments: MissingDeployment[];
  networkSummaries: NetworkSummary[];
  totalContracts: number;
  totalNetworks: number;
  overallStatus: 'healthy' | 'drift_detected' | 'critical';
}

export interface ConfigMismatch {
  contractName: string;
  network: string;
  field: string;
  configured: unknown;
  observed: unknown;
  severity: 'low' | 'medium' | 'high';
}

export interface MissingDeployment {
  network: string;
  contractName: string;
  severity: 'high';
}

export interface NetworkSummary {
  network: string;
  configuredCount: number;
  onchainVersion: string;
  discrepancies: ConfigMismatch[];
}

@Injectable()
export class DriftReportService {
  private readonly logger = new Logger(DriftReportService.name);
  private readonly cacheKey = 'contract-drift-report';
  private readonly ttl: number;

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly deploymentMetadataService: DeploymentMetadataService,
    private readonly contractReadAdapter: ContractReadServiceImpl,
  ) {
    this.ttl =
      parseInt(process.env.DRIFT_REPORT_CACHE_TTL_SECONDS ?? '', 10) || 300;
  }

  async generateReport(): Promise<DriftReport> {
    const enabled = this.configService.get<boolean>(
      'DRIFT_REPORT_ENABLED',
      true,
    );
    if (!enabled) {
      throw new Error('Drift report generation is disabled');
    }

    this.logger.log('Generating contract drift report');

    try {
      const cached = await this.redis.get<DriftReport>(this.cacheKey);
      if (cached !== null) {
        this.logger.debug('Drift report cache hit');
        return cached;
      }
    } catch {
      this.logger.debug('Redis unavailable – generating report from scratch');
    }

    const [deployments, onChainMeta] = await Promise.all([
      this.deploymentMetadataService.findAll(),
      this.contractReadAdapter.getContractMetadata(),
    ]);

    const configMismatches = this.detectConfigMismatches(
      deployments,
      onChainMeta,
    );
    const missingDeployments = this.detectMissingDeployments(deployments);
    const networkSummaries = this.buildNetworkSummaries(
      deployments,
      onChainMeta,
    );

    const report: DriftReport = {
      generatedAt: new Date(),
      configMismatches,
      missingDeployments,
      networkSummaries,
      totalContracts: deployments.length,
      totalNetworks: new Set(deployments.map(d => d.network)).size,
      overallStatus: this.computeOverallStatus(
        configMismatches,
        missingDeployments,
      ),
    };

    try {
      await this.redis.set(this.cacheKey, report, this.ttl);
    } catch {
      this.logger.debug('Failed to cache drift report');
    }

    this.logger.log(
      `Drift report complete: ${configMismatches.length} mismatch(es), ${missingDeployments.length} missing deployment(s) – status=${report.overallStatus}`,
    );

    return report;
  }

  generateHumanReadable(report: DriftReport): string {
    const lines: string[] = [];
    const ts = report.generatedAt.toISOString();

    lines.push('═══════════════════════════════════════════════════');
    lines.push('  CONTRACT DRIFT REPORT');
    lines.push(`  Generated: ${ts}`);
    lines.push(`  Overall status: ${report.overallStatus.toUpperCase()}`);
    lines.push(`  Contracts tracked: ${report.totalContracts}`);
    lines.push(`  Networks: ${report.totalNetworks}`);
    lines.push('═══════════════════════════════════════════════════');
    lines.push('');

    if (report.configMismatches.length === 0) {
      lines.push('✓ No configuration mismatches detected.');
    } else {
      lines.push(
        `✗ Configuration mismatches (${report.configMismatches.length}):`,
      );
      for (const m of report.configMismatches) {
        lines.push(
          `  [${m.severity.toUpperCase()}] ${m.network}/${m.contractName} — ${m.field}`,
        );
        lines.push(`    configured : ${String(m.configured)}`);
        lines.push(`    observed   : ${String(m.observed)}`);
      }
    }
    lines.push('');

    if (report.missingDeployments.length === 0) {
      lines.push('✓ No missing deployments detected.');
    } else {
      lines.push(
        `✗ Missing deployments (${report.missingDeployments.length}):`,
      );
      for (const d of report.missingDeployments) {
        lines.push(
          `  [${d.severity.toUpperCase()}] ${d.network}/${d.contractName}`,
        );
      }
    }
    lines.push('');

    lines.push('Network summaries:');
    for (const ns of report.networkSummaries) {
      lines.push(
        `  ${ns.network}: ${ns.configuredCount} configured contract(s), on-chain version=${ns.onchainVersion}`,
      );
      if (ns.discrepancies.length > 0) {
        for (const d of ns.discrepancies) {
          lines.push(`    ⚠ ${d.field} mismatch (severity=${d.severity})`);
        }
      }
    }
    lines.push('');

    lines.push('═══════════════════════════════════════════════════');
    lines.push(
      `  Actionable: ${report.overallStatus !== 'healthy' ? 'YES' : 'NO'}`,
    );
    lines.push('═══════════════════════════════════════════════════');

    return lines.join('\n');
  }

  private detectConfigMismatches(
    deployments: Array<{
      contractName: string;
      network: string;
      wasmHash: string;
      commitSha?: string;
    }>,
    onChainMeta: { version: string; name: string },
  ): ConfigMismatch[] {
    const mismatches: ConfigMismatch[] = [];

    for (const dep of deployments) {
      if (dep.wasmHash && dep.wasmHash !== onChainMeta.version) {
        mismatches.push({
          contractName: dep.contractName,
          network: dep.network,
          field: 'wasmHash vs on-chain version',
          configured: dep.wasmHash,
          observed: onChainMeta.version,
          severity: 'high',
        });
      }

      if (dep.commitSha && dep.commitSha !== onChainMeta.version) {
        mismatches.push({
          contractName: dep.contractName,
          network: dep.network,
          field: 'commitSha vs on-chain version',
          configured: dep.commitSha,
          observed: onChainMeta.version,
          severity: 'low',
        });
      }
    }

    return mismatches;
  }

  private detectMissingDeployments(
    deployments: Array<{ network: string; contractName: string }>,
  ): MissingDeployment[] {
    const missing: MissingDeployment[] = [];
    const expectedContracts = ['AidEscrow'];
    const expectedNetworks = ['testnet', 'mainnet'];

    const deployed = new Set(
      deployments.map(d => `${d.network}:${d.contractName}`),
    );

    for (const network of expectedNetworks) {
      for (const contractName of expectedContracts) {
        if (!deployed.has(`${network}:${contractName}`)) {
          missing.push({
            network,
            contractName,
            severity: 'high',
          });
        }
      }
    }

    return missing;
  }

  private buildNetworkSummaries(
    deployments: Array<{
      network: string;
      contractName: string;
    }>,
    onChainMeta: { version: string },
  ): NetworkSummary[] {
    const byNetwork = new Map<
      string,
      { count: number; discrepancies: ConfigMismatch[] }
    >();

    for (const dep of deployments) {
      const entry = byNetwork.get(dep.network) ?? {
        count: 0,
        discrepancies: [],
      };
      entry.count++;
      byNetwork.set(dep.network, entry);
    }

    return Array.from(byNetwork.entries()).map(([network, data]) => ({
      network,
      configuredCount: data.count,
      onchainVersion: onChainMeta.version,
      discrepancies: data.discrepancies,
    }));
  }

  private computeOverallStatus(
    mismatches: ConfigMismatch[],
    missing: MissingDeployment[],
  ): 'healthy' | 'drift_detected' | 'critical' {
    const hasHighSeverity =
      mismatches.some(m => m.severity === 'high') ||
      missing.some(m => m.severity === 'high');
    const hasMediumSeverity = mismatches.some(m => m.severity === 'medium');

    if (hasHighSeverity) return 'critical';
    if (hasMediumSeverity || missing.length > 0) return 'drift_detected';
    return 'healthy';
  }
}
