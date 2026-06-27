import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  CreateDeploymentMetadataDto,
  UpdateDeploymentMetadataDto,
  DeploymentMetadataResponseDto,
} from './dto/deployment-metadata.dto';

@Injectable()
export class DeploymentMetadataService {
  private readonly logger = new Logger(DeploymentMetadataService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new deployment metadata record
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
        metadata: dto.metadata ?? Prisma.DbNull,
      },
    });

    return this.mapToResponse(metadata);
  }

  /**
   * List all deployment metadata
   */
  async findAll(): Promise<DeploymentMetadataResponseDto[]> {
    const metadata = await this.prisma.deploymentMetadata.findMany({
      orderBy: { deployedAt: 'desc' },
    });

    return metadata.map(m => this.mapToResponse(m));
  }

  /**
   * Get deployment metadata by network
   */
  async findByNetwork(
    network: string,
  ): Promise<DeploymentMetadataResponseDto[]> {
    const metadata = await this.prisma.deploymentMetadata.findMany({
      where: { network },
      orderBy: { deployedAt: 'desc' },
    });

    return metadata.map(m => this.mapToResponse(m));
  }

  /**
   * Get deployment metadata by network and contract name
   */
  async findByNetworkAndContractName(
    network: string,
    contractName: string,
  ): Promise<DeploymentMetadataResponseDto | null> {
    const metadata = await this.prisma.deploymentMetadata.findUnique({
      where: {
        network_contractName: {
          network,
          contractName,
        },
      },
    });

    return metadata ? this.mapToResponse(metadata) : null;
  }

  /**
   * Get deployment metadata by contract ID
   */
  async findByContractId(
    contractId: string,
  ): Promise<DeploymentMetadataResponseDto | null> {
    const metadata = await this.prisma.deploymentMetadata.findFirst({
      where: { contractId },
    });

    return metadata ? this.mapToResponse(metadata) : null;
  }

  /**
   * Update deployment metadata
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
        metadata: dto.metadata === null ? Prisma.DbNull : dto.metadata,
      },
    });

    return this.mapToResponse(metadata);
  }

  /**
   * Delete deployment metadata
   */
  async delete(id: string): Promise<void> {
    this.logger.log(`Deleting deployment metadata ${id}`);
    await this.prisma.deploymentMetadata.delete({
      where: { id },
    });
  }

  /**
   * Map Prisma model to response DTO
   */
  private mapToResponse(metadata: any): DeploymentMetadataResponseDto {
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
      metadata: metadata.metadata ?? undefined,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    };
  }
}
