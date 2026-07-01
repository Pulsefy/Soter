import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  ContractAwareMetadata,
  VerificationResultDto,
} from './dto/verification-result.dto';
import { DeploymentMetadataService } from '../deployment-metadata/deployment-metadata.service';
import { DeploymentMetadataResponseDto } from '../deployment-metadata/dto/deployment-metadata.dto';

@Injectable()
export class VerificationMetadataService {
  private readonly logger = new Logger(VerificationMetadataService.name);
  private readonly network: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly deploymentMetadataService: DeploymentMetadataService,
  ) {
    this.network =
      this.configService.get<string>('STELLAR_NETWORK') || 'testnet';
  }

  /**
   * Generate contract-aware metadata for a verification result
   */
  async generateMetadata(
    claimId: string,
    campaignId: string,
  ): Promise<ContractAwareMetadata> {
    try {
      // Fetch deployment metadata for the campaign via network
      let deploymentMetadata: DeploymentMetadataResponseDto | null = null;
      try {
        // Use the actual method available in DeploymentMetadataService
        const network = this.network;
        const allDeployments =
          await this.deploymentMetadataService.findByNetwork(network);

        if (allDeployments && allDeployments.length > 0) {
          // Try to find a deployment with matching contract name
          // Use 'aid_escrow' as the default contract name
          const aidEscrowDeployment = allDeployments.find(
            (d: DeploymentMetadataResponseDto) =>
              d.contractName === 'aid_escrow',
          );
          if (aidEscrowDeployment) {
            deploymentMetadata = aidEscrowDeployment;
          } else {
            // Fall back to the first deployment
            deploymentMetadata = allDeployments[0];
          }
        }
      } catch (error) {
        this.logger.warn(
          `Failed to fetch deployment metadata for network ${this.network}: ${error}`,
        );
        // Continue without deployment metadata
      }

      // Fetch claim details with proper typing
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
      // Use type assertion for fields that may exist on the claim but not in the Prisma type
      const claimAny = claim as any;

      // Get package ID from various sources
      let packageId: string;
      if (claimAny.packageId) {
        packageId = claimAny.packageId;
      } else if (deploymentMetadata?.contractId) {
        packageId = deploymentMetadata.contractId;
      } else {
        packageId = this.generatePackageId(claimId);
      }

      // Build the metadata object
      const metadata: ContractAwareMetadata = {
        campaignId,
        claimId,
        packageId,
        network: this.network,
        chainId:
          this.configService.get<string>('STELLAR_CHAIN_ID') || 'testnet',
        version: deploymentMetadata?.commitSha
          ? `v${deploymentMetadata.commitSha.substring(0, 8)}`
          : '1.0.0',
        timestamp: new Date(),
      };

      // Add contract address if available
      if (deploymentMetadata?.contractId) {
        metadata.contractAddress = deploymentMetadata.contractId;
      }

      // Add transaction hash if available from claim or deployment
      if (claimAny.transactionHash) {
        metadata.transactionHash = claimAny.transactionHash;
      } else if (deploymentMetadata?.transactionHash) {
        metadata.transactionHash = deploymentMetadata.transactionHash;
      }

      this.logger.log(
        `Generated contract-aware metadata for claim ${claimId}: ` +
          `packageId=${metadata.packageId}, network=${metadata.network}`,
      );

      return metadata;
    } catch (error) {
      this.logger.error(
        `Failed to generate metadata for claim ${claimId}: ${error}`,
      );

      // Return minimal valid metadata even on error
      return {
        campaignId,
        claimId,
        packageId: this.generatePackageId(claimId),
        network: this.network,
        chainId:
          this.configService.get<string>('STELLAR_CHAIN_ID') || 'testnet',
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
    } else if (
      typeof metadata.packageId !== 'string' ||
      metadata.packageId.length < 3
    ) {
      errors.push('packageId must be a valid string with minimum length 3');
    }

    if (
      metadata.network &&
      !['testnet', 'mainnet', 'public'].includes(metadata.network)
    ) {
      errors.push('network must be one of: testnet, mainnet, public');
    }

    // Validate chainId if present
    if (metadata.chainId && typeof metadata.chainId !== 'string') {
      errors.push('chainId must be a string');
    }

    // Validate version if present
    if (metadata.version && typeof metadata.version !== 'string') {
      errors.push('version must be a string');
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
    try {
      const metadata = await this.generateMetadata(claimId, campaignId);
      const validationErrors = this.validateMetadata(metadata);

      const enhancedResult: VerificationResultDto = {
        score: result.score,
        confidence: result.confidence,
        details: result.details,
        processedAt: result.processedAt || new Date(),
        metadata,
        warnings: [
          ...(result.warnings || []),
          ...(validationErrors.length > 0
            ? [`Metadata validation warnings: ${validationErrors.join(', ')}`]
            : []),
        ],
        validationErrors:
          validationErrors.length > 0 ? validationErrors : undefined,
      };

      this.logger.log(
        `Enhanced verification result for claim ${claimId} with metadata ` +
          `(packageId: ${metadata.packageId}, network: ${metadata.network})`,
      );

      return enhancedResult;
    } catch (error) {
      this.logger.error(
        `Failed to enhance result with metadata for claim ${claimId}: ${error}`,
      );

      // Return the original result without metadata enhancement
      return {
        ...result,
        warnings: [
          ...(result.warnings || []),
          'Failed to generate contract-aware metadata',
        ],
      };
    }
  }

  /**
   * Validate incoming webhook payload for metadata
   */
  validateWebhookPayload(payload: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!payload || typeof payload !== 'object') {
      return { isValid: false, errors: ['Invalid payload: must be an object'] };
    }

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
      if (typeof payload.result !== 'object') {
        errors.push('result must be an object');
      } else {
        if (
          typeof payload.result.score !== 'number' ||
          payload.result.score < 0 ||
          payload.result.score > 1
        ) {
          errors.push('result.score must be a number between 0 and 1');
        }
        if (
          typeof payload.result.confidence !== 'number' ||
          payload.result.confidence < 0 ||
          payload.result.confidence > 1
        ) {
          errors.push('result.confidence must be a number between 0 and 1');
        }
        if (
          payload.result.details &&
          typeof payload.result.details !== 'object'
        ) {
          errors.push('result.details must be an object');
        }
      }
    } else {
      errors.push('result is required');
    }

    // Validate network if present
    if (
      payload.network &&
      !['testnet', 'mainnet', 'public'].includes(payload.network)
    ) {
      errors.push('network must be one of: testnet, mainnet, public');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Check if a string is a valid UUID
   */
  private isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Generate a deterministic package ID from a claim ID
   */
  private generatePackageId(claimId: string): string {
    if (!claimId) {
      return `pkg_${Date.now()}`;
    }
    // Use first 8 chars of claim ID as package ID for fallback
    return `pkg_${claimId.substring(0, 8)}`;
  }

  /**
   * Extract metadata from a webhook payload
   */
  extractMetadataFromPayload(
    payload: any,
  ): Partial<ContractAwareMetadata> | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const metadata: Partial<ContractAwareMetadata> = {};

    // Extract standard fields
    if (payload.claimId) {
      metadata.claimId = payload.claimId;
    }
    if (payload.campaignId) {
      metadata.campaignId = payload.campaignId;
    }
    if (payload.packageId) {
      metadata.packageId = payload.packageId;
    }
    if (payload.transactionHash) {
      metadata.transactionHash = payload.transactionHash;
    }
    if (payload.contractAddress) {
      metadata.contractAddress = payload.contractAddress;
    }
    if (payload.network) {
      metadata.network = payload.network;
    }
    if (payload.chainId) {
      metadata.chainId = payload.chainId;
    }
    if (payload.version) {
      metadata.version = payload.version;
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  /**
   * Merge metadata from multiple sources with priority order
   */
  mergeMetadata(
    ...sources: (Partial<ContractAwareMetadata> | null | undefined)[]
  ): Partial<ContractAwareMetadata> {
    const result: Partial<ContractAwareMetadata> = {};

    for (const source of sources) {
      if (source) {
        // Only set fields that are not already set (first source wins)
        for (const key of Object.keys(
          source,
        ) as (keyof ContractAwareMetadata)[]) {
          if (
            !(key in result) &&
            source[key] !== undefined &&
            source[key] !== null
          ) {
            // Type-safe assignment with explicit type handling
            switch (key) {
              case 'timestamp': {
                // Handle Date conversion - wrapped in braces
                const timestamp = source[key];
                if (
                  timestamp instanceof Date ||
                  typeof timestamp === 'string'
                ) {
                  result[key] =
                    timestamp instanceof Date ? timestamp : new Date(timestamp);
                }
                break;
              }
              default:
                // For all other fields, use type assertion
                result[key] = source[key];
                break;
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Normalize network name to standard format
   */
  normalizeNetwork(network: string): string {
    const normalized = network.toLowerCase().trim();
    if (normalized === 'mainnet' || normalized === 'public') {
      return 'mainnet';
    }
    if (normalized === 'testnet' || normalized === 'test') {
      return 'testnet';
    }
    return normalized;
  }

  /**
   * Check if metadata is complete (all required fields present)
   */
  isMetadataComplete(
    metadata: ContractAwareMetadata | Partial<ContractAwareMetadata>,
  ): boolean {
    return !!(
      metadata &&
      metadata.campaignId &&
      metadata.claimId &&
      metadata.packageId
    );
  }
}
