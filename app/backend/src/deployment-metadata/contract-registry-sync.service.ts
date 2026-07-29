import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContractConfigCacheService } from './contract-config-cache.service';
import {
  ContractRegistrySource,
  loadContractRegistryArtifact,
  resolveRegistryArtifactPath,
} from './contract-registry.artifact';

export interface ContractRegistrySyncResult {
  source: ContractRegistrySource;
  contractCount: number;
  networkCount: number;
}

@Injectable()
export class ContractRegistrySyncService implements OnModuleInit {
  private readonly logger = new Logger(ContractRegistrySyncService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly contractConfigCache: ContractConfigCacheService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncFromConfiguredSource();
  }

  async syncFromConfiguredSource(): Promise<ContractRegistrySyncResult> {
    if (
      ['1', 'true', 'yes'].includes(
        (
          this.configService.get<string>('CONTRACT_REGISTRY_SYNC_DISABLED') ??
          ''
        ).toLowerCase(),
      )
    ) {
      return this.logFallback(
        'database',
        'CONTRACT_REGISTRY_SYNC_DISABLED is set',
      );
    }

    const configuredPath = this.configService.get<string>(
      'CONTRACT_REGISTRY_PATH',
    );
    const artifactPath = resolveRegistryArtifactPath(configuredPath);

    if (!artifactPath) {
      const envContractId =
        this.configService.get<string>('AID_ESCROW_CONTRACT_ID') ??
        this.configService.get<string>('SOROBAN_CONTRACT_ID');
      return this.logFallback(
        envContractId ? 'env' : 'database',
        configuredPath
          ? `CONTRACT_REGISTRY_PATH not found: ${configuredPath}`
          : 'No onchain registry artifact found',
      );
    }

    try {
      const records = loadContractRegistryArtifact(artifactPath);

      if (records.length === 0) {
        return this.logFallback(
          'database',
          `Onchain registry artifact has no deployments: ${artifactPath}`,
        );
      }

      for (const record of records) {
        await this.prisma.deploymentMetadata.upsert({
          where: {
            network_contractName: {
              network: record.network,
              contractName: record.contractName,
            },
          },
          update: {
            contractId: record.contractId,
            wasmHash: record.wasmHash,
            deployedAt: new Date(record.deployedAt),
            commitSha: record.commitSha,
            deployer: record.deployer,
            transactionHash: record.transactionHash,
            metadata: record.metadata as Prisma.InputJsonValue,
          },
          create: {
            contractName: record.contractName,
            network: record.network,
            contractId: record.contractId,
            wasmHash: record.wasmHash,
            deployedAt: new Date(record.deployedAt),
            commitSha: record.commitSha,
            deployer: record.deployer,
            transactionHash: record.transactionHash,
            metadata: record.metadata as Prisma.InputJsonValue,
          },
        });
      }

      await this.contractConfigCache.invalidateAll();

      const networks = new Set(records.map(record => record.network));
      this.logger.log(
        `Contract registry source active: artifact (${artifactPath}); synced ${records.length} contract deployment(s) across ${networks.size} network(s)`,
      );

      return {
        source: { kind: 'artifact', path: artifactPath },
        contractCount: records.length,
        networkCount: networks.size,
      };
    } catch (error) {
      return this.logFallback(
        'database',
        `Failed to load onchain registry artifact ${artifactPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async logFallback(
    kind: 'env' | 'database',
    reason: string,
  ): Promise<ContractRegistrySyncResult> {
    this.logger.warn(
      `Contract registry source active: ${kind} fallback; ${reason}`,
    );

    return {
      source: { kind, reason },
      contractCount: 0,
      networkCount: 0,
    };
  }
}
