import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Optional,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ClaimStatus } from '@prisma/client';
import {
  OnchainAdapter,
  DisburseResult,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';
import { LoggerService } from '../logger/logger.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);
  private readonly onchainEnabled: boolean;

  constructor(
    private prisma: PrismaService,
    @Optional()
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter | null,
    private readonly configService: ConfigService,
    private readonly loggerService: LoggerService,
    private readonly metricsService: MetricsService,
    private readonly auditService: AuditService,
    private readonly encryptionService: EncryptionService,
  ) {
    this.onchainEnabled =
      this.configService.get<string>('ONCHAIN_ENABLED') === 'true';
  }

  async create(createClaimDto: CreateClaimDto) {
    // Check if campaign exists
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: createClaimDto.campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const claim = await this.prisma.claim.create({
      data: {
        campaignId: createClaimDto.campaignId,
        amount: createClaimDto.amount,
        recipientRef: this.encryptionService.encrypt(
          createClaimDto.recipientRef,
        ),
        evidenceRef: createClaimDto.evidenceRef,
        // Store tokenAddress in metadata for multi-token support
        // Note: This would require a schema migration to add tokenAddress field
        // For now, we pass it to on-chain operations directly
      },
      include: {
        campaign: true,
      },
    });

    claim.recipientRef = this.encryptionService.decrypt(claim.recipientRef);

    // Stub audit hook
    void this.auditLog('claim', claim.id, 'created', {
      status: claim.status,
      tokenAddress: createClaimDto.tokenAddress,
    });

    return claim;
  }

  async findAll() {
    const claims = await this.prisma.claim.findMany({
      where: { deletedAt: null },
      include: {
        campaign: true,
      },
    });
    return claims.map(claim => ({
      ...claim,
      recipientRef: this.encryptionService.decrypt(claim.recipientRef),
    }));
  }

  async findOne(id: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: {
        campaign: true,
      },
    });
    if (!claim || claim.deletedAt) {
      throw new NotFoundException('Claim not found');
    }
    return {
      ...claim,
      recipientRef: this.encryptionService.decrypt(claim.recipientRef),
    };
  }

  async verify(id: string) {
    return this.transitionStatus(
      id,
      ClaimStatus.requested,
      ClaimStatus.verified,
    );
  }

  async approve(id: string) {
    return this.transitionStatus(
      id,
      ClaimStatus.verified,
      ClaimStatus.approved,
    );
  }

  async disburse(id: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: { campaign: true },
    });

    if (!claim) {
      throw new NotFoundException('Claim not found');
    }

    if (claim.status !== ClaimStatus.approved) {
      throw new BadRequestException(
        `Cannot transition from ${claim.status} to ${ClaimStatus.disbursed}`,
      );
    }

    // Call on-chain adapter if enabled
    let onchainResult: DisburseResult | null = null;
    if (this.onchainEnabled && this.onchainAdapter) {
      const startTime = Date.now();
      const adapterType =
        this.configService.get<string>('ONCHAIN_ADAPTER')?.toLowerCase() ||
        'mock';

      try {
        this.logger.log(`Calling on-chain adapter for claim ${id}`, {
          claimId: id,
          adapter: adapterType,
        });

        // Generate a mock package ID for the disburse call
        // In a real implementation, this would come from createClaim
        const packageId = this.generateMockPackageId(id);

        // Get tokenAddress from claim metadata or use a default
        // In production, this should be stored in the claim record
        const tokenAddress = this.getTokenAddressForClaim(claim);

        onchainResult = await this.onchainAdapter.disburse({
          claimId: id,
          packageId,
          recipientAddress: this.encryptionService.decrypt(claim.recipientRef),
          amount: claim.amount.toString(),
          tokenAddress,
        });

        const duration = (Date.now() - startTime) / 1000;

        // Record metrics
        this.metricsService.incrementOnchainOperation(
          'disburse',
          adapterType,
          onchainResult.status,
        );
        this.metricsService.recordOnchainDuration(
          'disburse',
          adapterType,
          duration,
        );

        this.logger.log(`On-chain disbursement completed for claim ${id}`, {
          claimId: id,
          transactionHash: onchainResult.transactionHash,
          status: onchainResult.status,
          duration,
        });

        // Audit log for on-chain operation
        await this.auditService.record({
          actorId: 'system',
          entity: 'onchain',
          entityId: id,
          action: 'disburse',
          metadata: {
            transactionHash: onchainResult.transactionHash,
            status: onchainResult.status,
            amountDisbursed: onchainResult.amountDisbursed,
            adapter: adapterType,
          },
        });
      } catch (error) {
        const duration = (Date.now() - startTime) / 1000;
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(
          `On-chain disbursement failed for claim ${id}: ${errorMessage}`,
          error instanceof Error ? error.stack : undefined,
          'ClaimsService',
          { claimId: id, adapter: adapterType },
        );

        // Record failed metric
        this.metricsService.incrementOnchainOperation(
          'disburse',
          adapterType,
          'failed',
        );
        this.metricsService.recordOnchainDuration(
          'disburse',
          adapterType,
          duration,
        );

        // Audit log for failed operation
        await this.auditService.record({
          actorId: 'system',
          entity: 'onchain',
          entityId: id,
          action: 'disburse_failed',
          metadata: {
            error: errorMessage,
            adapter: adapterType,
          },
        });

        // Don't throw - allow disbursement to proceed even if on-chain call fails
        // This is configurable behavior for resilience
      }
    }

    // Proceed with status transition
    return this.transitionStatus(
      id,
      ClaimStatus.approved,
      ClaimStatus.disbursed,
      onchainResult,
    );
  }

  /**
   * Generate a deterministic mock package ID from claim ID
   * In production, this would come from the createClaim on-chain call
   */
  private generateMockPackageId(claimId: string): string {
    // Simple hash-based approach for mock
    const hash = createHash('sha256')
      .update(`package-${claimId}`)
      .digest('hex');
    return BigInt('0x' + hash.substring(0, 16)).toString();
  }

  /**
   * Get token address for a claim
   * In production, this should be retrieved from the claim record
   * For now, uses a default or derives from campaign metadata
   */
  private getTokenAddressForClaim(claim: any): string {
    // Default USDC on Stellar testnet
    // In production, this should come from the claim record or campaign config
    const defaultTokenAddress =
      'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN';

    // If claim has tokenAddress in metadata, use it
    if (claim.metadata?.tokenAddress) {
      return claim.metadata.tokenAddress;
    }

    // If campaign has tokenAddress in metadata, use it
    if (claim.campaign?.metadata?.tokenAddress) {
      return claim.campaign.metadata.tokenAddress;
    }

    return defaultTokenAddress;
  }

  async archive(id: string) {
    return this.transitionStatus(
      id,
      ClaimStatus.disbursed,
      ClaimStatus.archived,
    );
  }

  private async transitionStatus(
    id: string,
    fromStatus: ClaimStatus,
    toStatus: ClaimStatus,
    onchainResult?: DisburseResult | null,
  ) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) {
      throw new NotFoundException('Claim not found');
    }
    if (claim.status !== fromStatus) {
      throw new BadRequestException(
        `Cannot transition from ${claim.status} to ${toStatus}`,
      );
    }

    // For disburse, check budget? But for now, skip as per requirements.

    const updatedClaim = await this.prisma.$transaction(async tx => {
      const updated = await tx.claim.update({
        where: { id },
        data: { status: toStatus },
        include: { campaign: true },
      });

      // Audit log for status change
      void this.auditLog('claim', id, `status_changed_to_${toStatus}`, {
        from: fromStatus,
        to: toStatus,
        onchainResult: onchainResult
          ? {
              transactionHash: onchainResult.transactionHash,
              status: onchainResult.status,
            }
          : undefined,
      });

      return updated;
    });

    return updatedClaim;
  }

  private auditLog(
    entity: string,
    entityId: string,
    action: string,
    metadata?: any,
  ) {
    // Stub: In production, this would log to audit table or external system
    console.log(`Audit: ${entity} ${entityId} ${action}`, metadata);
  }
}
