import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, DeploymentMetadata } from '@prisma/client';
import {
  CreateDeploymentMetadataDto,
  UpdateDeploymentMetadataDto,
  DeploymentMetadataResponseDto,
} from './dto/deployment-metadata.dto';
import { ContractConfigCacheService } from './contract-config-cache.service';

@Injectable()
export class DeploymentMetadataService {
  private readonly logger = new Logger(DeploymentMetadataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contractConfigCache: ContractConfigCacheService,
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
   * Get a single deployment metadata record by id.
   *
   * Reads through Prisma rather than the contract-config cache: the cache is
   * keyed by network / contract id for request-path lookups, while admin
   * operations (see `ContractMigrationService`) address records by id.
   */
  async findById(id: string): Promise<DeploymentMetadataResponseDto | null> {
    const metadata = await this.prisma.deploymentMetadata.findUnique({
      where: { id },
    });
    return metadata ? this.mapToResponse(metadata) : null;
  }

  /**
   * Roll deployment metadata forward after a migration has been confirmed
   * on-chain.
   *
   * Callers must verify the on-chain version actually changed before calling
   * this — it is the only step that makes a migration visible in the API, so it
   * deliberately takes the observed versions rather than the requested one.
   * Existing `metadata` keys are preserved; the migration fields are merged on
   * top of them. `deployedAt` and `wasmHash` are left alone, because a state
   * migration does not by itself prove a new WASM hash was installed.
   */
  async recordVerifiedMigration(
    id: string,
    params: {
      transactionHash: string;
      previousVersion: string;
      contractVersion: string;
      migratedAt: Date;
    },
  ): Promise<DeploymentMetadataResponseDto> {
    const existing = await this.prisma.deploymentMetadata.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Deployment metadata ${id} not found`);
    }

    const existingMetadata =
      (existing.metadata as Record<string, unknown> | null) ?? {};

    const metadata = await this.prisma.deploymentMetadata.update({
      where: { id },
      data: {
        transactionHash: params.transactionHash,
        metadata: {
          ...existingMetadata,
          contractVersion: params.contractVersion,
          previousContractVersion: params.previousVersion,
          migrationTransactionHash: params.transactionHash,
          migratedAt: params.migratedAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    await this.contractConfigCache.invalidateAll();
    return this.mapToResponse(metadata);
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
      metadata:
        (metadata.metadata as Record<string, unknown> | null) ?? undefined,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    };
  }
}
