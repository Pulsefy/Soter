import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, DeploymentMetadata } from '@prisma/client';
import {
  CreateDeploymentMetadataDto,
  UpdateDeploymentMetadataDto,
  DeploymentMetadataResponseDto,
} from './dto/deployment-metadata.dto';
import { ContractConfigCacheService } from './contract-config-cache.service';
import {
  ONCHAIN_ADAPTER_TOKEN,
  OnchainAdapter,
} from '../onchain/onchain.adapter';
import { MigrateDeploymentResponseDto } from './dto/deployment-metadata.dto';

@Injectable()
export class DeploymentMetadataService {
  private readonly logger = new Logger(DeploymentMetadataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contractConfigCache: ContractConfigCacheService,
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
  ) {}

  /**
   * Create a new deployment metadata record.
   * Invalidates the contract-config cache so subsequent reads are fresh.
   */
  async create(
    dto: CreateDeploymentMetadataDto,
  ): Promise<DeploymentMetadataResponseDto> {
    this.logger.log(
      `Creating deployment metadata for ${dto.network}/${dto.contractName}`,
    );

    const metadata = await this.prisma.deploymentMetadata.create({
      data: {
        contractName: dto.contractName,
        network: dto.network,
        contractId: dto.contractId,
        wasmHash: dto.wasmHash,
        deployedAt: new Date(dto.deployedAt),
        commitSha: dto.commitSha ?? null,
        deployer: dto.deployer ?? null,
        transactionHash: dto.transactionHash ?? null,
        contractVersion: dto.contractVersion ?? null,
        // Use Prisma.DbNull instead of standard null variables for Json fields
        metadata: (dto.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
      },
    });

    await this.contractConfigCache.invalidateAll();
    return this.mapToResponse(metadata);
  }

  /**
   * List all deployment metadata (cache-backed).
   */
  async findAll(): Promise<DeploymentMetadataResponseDto[]> {
    return this.contractConfigCache.getAll();
  }

  /**
   * Get deployment metadata by network (cache-backed).
   */
  async findByNetwork(
    network: string,
  ): Promise<DeploymentMetadataResponseDto[]> {
    return this.contractConfigCache.getByNetwork(network);
  }

  /**
   * Get deployment metadata by network and contract name (cache-backed).
   */
  async findByNetworkAndContractName(
    network: string,
    contractName: string,
  ): Promise<DeploymentMetadataResponseDto | null> {
    return this.contractConfigCache.getByNetworkAndContractName(
      network,
      contractName,
    );
  }

  /**
   * Get deployment metadata by contract ID (cache-backed).
   */
  async findByContractId(
    contractId: string,
  ): Promise<DeploymentMetadataResponseDto | null> {
    return this.contractConfigCache.getByContractId(contractId);
  }

  /**
   * Update deployment metadata.
   * Invalidates the contract-config cache so subsequent reads are fresh.
   */
  async update(
    id: string,
    dto: UpdateDeploymentMetadataDto,
  ): Promise<DeploymentMetadataResponseDto> {
    this.logger.log(`Updating deployment metadata ${id}`);

    const metadata = await this.prisma.deploymentMetadata.update({
      where: { id },
      data: {
        deployedAt: dto.deployedAt ? new Date(dto.deployedAt) : undefined,
        commitSha: dto.commitSha,
        deployer: dto.deployer,
        transactionHash: dto.transactionHash,
        contractVersion: dto.contractVersion,
        // Ensure explicit fallback behavior for Json type check compliance
        metadata:
          dto.metadata === null
            ? Prisma.DbNull
            : (dto.metadata as Prisma.InputJsonValue | undefined),
      },
    });

    await this.contractConfigCache.invalidateAll();
    return this.mapToResponse(metadata);
  }

  /**
   * Migrate a deployment and persist its version only after on-chain
   * verification succeeds.
   */
  async migrate(
    id: string,
    newVersion: number,
  ): Promise<MigrateDeploymentResponseDto> {
    const deployment = await this.prisma.deploymentMetadata.findUnique({
      where: { id },
    });
    if (!deployment) {
      throw new NotFoundException(`Deployment metadata ${id} not found`);
    }

    const previousVersion = await this.onchainAdapter.getContractVersion({
      contractId: deployment.contractId,
    });
    if (newVersion <= previousVersion) {
      throw new ConflictException(
        `Contract ${deployment.contractId} is already at version ${previousVersion}; migration target must be greater`,
      );
    }
    const migration = await this.onchainAdapter.migrateContract({
      contractId: deployment.contractId,
      newVersion,
    });
    const verifiedVersion = await this.onchainAdapter.getContractVersion({
      contractId: deployment.contractId,
    });

    if (verifiedVersion !== newVersion || verifiedVersion === previousVersion) {
      throw new ConflictException(
        `Contract ${deployment.contractId} reported version ${verifiedVersion} after migration; expected ${newVersion}`,
      );
    }

    const updated = await this.prisma.deploymentMetadata.update({
      where: { id },
      data: { contractVersion: verifiedVersion },
    });
    await this.contractConfigCache.invalidateAll();

    return {
      deployment: this.mapToResponse(updated),
      previousVersion,
      verifiedVersion,
      transactionHash: migration.transactionHash,
      migratedAt: migration.timestamp,
    };
  }

  /**
   * Delete deployment metadata.
   * Invalidates the contract-config cache so the deleted entry isn't served.
   */
  async delete(id: string): Promise<void> {
    this.logger.log(`Deleting deployment metadata ${id}`);
    await this.prisma.deploymentMetadata.delete({
      where: { id },
    });
    await this.contractConfigCache.invalidateAll();
  }

  /**
   * Admin-triggered cache refresh.
   * Drops all contract-config keys and re-warms them from the DB.
   */
  async refreshCache(): Promise<{
    refreshedAt: Date;
    contractCount: number;
    networkCount: number;
  }> {
    return this.contractConfigCache.refreshAll();
  }

  /**
   * Map Prisma model to response DTO
   */
  private mapToResponse(
    metadata: DeploymentMetadata,
  ): DeploymentMetadataResponseDto {
    return {
      id: metadata.id,
      contractName: metadata.contractName,
      network: metadata.network,
      contractId: metadata.contractId,
      wasmHash: metadata.wasmHash,
      deployedAt: metadata.deployedAt,
      commitSha: metadata.commitSha ?? undefined,
      deployer: metadata.deployer ?? undefined,
      transactionHash: metadata.transactionHash ?? undefined,
      contractVersion: metadata.contractVersion ?? undefined,
      metadata:
        (metadata.metadata as Record<string, unknown> | null) ?? undefined,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    };
  }
}
