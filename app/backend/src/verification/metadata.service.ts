import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ContractAwareMetadata, VerificationResultDto } from './dto/verification-result.dto';
import { DeploymentMetadataService } from '../deployment-metadata/deployment-metadata.service';

@Injectable()
export class VerificationMetadataService {
  private readonly logger = new Logger(VerificationMetadataService.name);
  private readonly network: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly deploymentMetadataService: DeploymentMetadataService,
  ) {
    this.network = this.configService.get<string>('STELLAR_NETWORK') || 'testnet';
  }

  /**
   * Generate contract-aware metadata for a verification result
   */
  async generateMetadata(
    claimId: string,
    campaignId: string,
  ): Promise<ContractAwareMetadata> {
    try {
      // Fetch deployment metadata for the campaign
      const deploymentMetadata = await this.deploymentMetadataService.getDeploymentMetadata(
        campaignId,
      );

      // Fetch claim details
      const claim = await this.prisma.claim.findUnique({
        where: { id: claimId },
        include: {
          campaign: true,
        },
      });

      if (!claim) {
        throw new BadRequestException(`Claim ${claimId} not found`);
      }

      // Build metadata with stable identifiers
      const metadata: ContractAwareMetadata = {
        campaignId,
        claimId,
        packageId: claim.packageId || deploymentMetadata?.packageId || this.generatePackageId(claimId),
        network: this.network,
        chainId: this.configService.get<string>('STELLAR_CHAIN_ID') || 'testnet',
        version: deploymentMetadata?.version || '1.0.0',
        timestamp: new Date(),
      };

      // Add contract address if available
      if (deploymentMetadata?.contractAddress) {
        metadata.contractAddress = deploymentMetadata.contractAddress;
      }

      // Add transaction hash if available from claim
      if (claim.transactionHash) {
        metadata.transactionHash = claim.transactionHash;
      }

      this.logger.log(
        `Generated contract-aware metadata for claim ${claimId}: ` +
          `packageId=${metadata.packageId}, network=${metadata.network}`,
      );

      return metadata;
    } catch (error) {
      this.logger.error(`Failed to generate metadata for claim ${claimId}: ${error}`);
      
      // Return minimal valid metadata even on error
      return {
        campaignId,
        claimId,
        packageId: this.generatePackageId(claimId),
        network: this.network,
        chainId: this.configService.get<string>('STELLAR_CHAIN_ID') || 'testnet',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Validate that all required metadata fields are present and correctly formatted
   */
  validateMetadata(metadata: ContractAwareMetadata): string[] {
    const errors: string[] = [];

    if (!metadata.campaignId) {
      errors.push('campaignId is required');
    } else if (!this.isValidUUID(metadata.campaignId)) {
      errors.push('campaignId must be a valid UUID');
    }

    if (!metadata.claimId) {
      errors.push('claimId is required');
    } else if (!this.isValidUUID(metadata.claimId)) {
      errors.push('claimId must be a valid UUID');
    }

    if (!metadata.packageId) {
      errors.push('packageId is required');
    } else if (typeof metadata.packageId !== 'string' || metadata.packageId.length < 3) {
      errors.push('packageId must be a valid string with minimum length 3');
    }

    if (metadata.network && !['testnet', 'mainnet', 'public'].includes(metadata.network)) {
      errors.push('network must be one of: testnet, mainnet, public');
    }

    return errors;
  }

  /**
   * Enhance a verification result with metadata
   */
  async enhanceWithMetadata(
    result: VerificationResultDto,
    claimId: string,
    campaignId: string,
  ): Promise<VerificationResultDto> {
    const metadata = await this.generateMetadata(claimId, campaignId);
    const validationErrors = this.validateMetadata(metadata);

    const enhancedResult: VerificationResultDto = {
      ...result,
      metadata,
      warnings: [
        ...(result.warnings || []),
        ...(validationErrors.length > 0
          ? [`Metadata validation warnings: ${validationErrors.join(', ')}`]
          : []),
      ],
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    };

    this.logger.log(
      `Enhanced verification result for claim ${claimId} with metadata ` +
        `(packageId: ${metadata.packageId}, network: ${metadata.network})`,
    );

    return enhancedResult;
  }

  /**
   * Validate incoming webhook payload for metadata
   */
  validateWebhookPayload(payload: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    const requiredFields = ['claimId', 'campaignId', 'packageId'];
    for (const field of requiredFields) {
      if (!payload[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate UUIDs
    if (payload.claimId && !this.isValidUUID(payload.claimId)) {
      errors.push('claimId must be a valid UUID');
    }

    if (payload.campaignId && !this.isValidUUID(payload.campaignId)) {
      errors.push('campaignId must be a valid UUID');
    }

    // Validate result
    if (payload.result) {
      if (typeof payload.result.score !== 'number' || payload.result.score < 0 || payload.result.score > 1) {
        errors.push('result.score must be a number between 0 and 1');
      }
      if (typeof payload.result.confidence !== 'number' || payload.result.confidence < 0 || payload.result.confidence > 1) {
        errors.push('result.confidence must be a number between 0 and 1');
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Check if a string is a valid UUID
   */
  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Generate a deterministic package ID from a claim ID
   */
  private generatePackageId(claimId: string): string {
    // Use first 8 chars of claim ID as package ID for fallback
    return `pkg_${claimId.substring(0, 8)}`;
  }
}