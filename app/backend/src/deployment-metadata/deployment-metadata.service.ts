import { Injectable, Logger } from '@nestjs/common';
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
