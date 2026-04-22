import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Optional,
  Inject,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ClaimStatus } from '@prisma/client';
import {
  OnchainAdapter,
  DisburseResult,
  RevokeAidPackageResult,
  RefundAidPackageResult,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';
import { LoggerService } from '../logger/logger.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { OnchainService } from '../onchain/onchain.service';

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
    private readonly onchainService: OnchainService,
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
        expiresAt: createClaimDto.expiresAt,
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

  /**
   * Cron job that runs every hour to clean up expired claims
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredClaims() {
    this.logger.log('Starting expired claims cleanup job');
    
    const now = new Date();
    
    try {
      // Find claims that have expired and are in requested or verified status
      const expiredClaims = await this.prisma.claim.findMany({
        where: {
          expiresAt: {
            lt: now,
          },
          status: {
            in: [ClaimStatus.requested, ClaimStatus.verified],
          },
          deletedAt: null,
        },
        include: {
          campaign: true,
        },
      });

      if (expiredClaims.length === 0) {
        this.logger.log('No expired claims found');
        return;
      }

      this.logger.log(`Found ${expiredClaims.length} expired claims to process`);

      let processedCount = 0;
      let failedCount = 0;

      for (const claim of expiredClaims) {
        try {
          await this.processExpiredClaim(claim);
          processedCount++;
        } catch (error) {
          failedCount++;
          this.logger.error(
            `Failed to process expired claim ${claim.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error instanceof Error ? error.stack : undefined,
            'ClaimsService',
            { claimId: claim.id }
          );
        }
      }

      this.logger.log(
        `Expired claims cleanup completed. Processed: ${processedCount}, Failed: ${failedCount}`
      );

      // Record metrics
      this.metricsService.incrementCounter('expired_claims_processed_total', processedCount);
      this.metricsService.incrementCounter('expired_claims_failed_total', failedCount);

    } catch (error) {
      this.logger.error(
        `Expired claims cleanup job failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
        'ClaimsService'
      );
    }
  }

  /**
   * Process a single expired claim
   */
  private async processExpiredClaim(claim: any) {
    const packageId = this.generateMockPackageId(claim.id);
    let onchainResult: RevokeAidPackageResult | RefundAidPackageResult | null = null;

    // Call on-chain adapter if enabled to revoke or refund
    if (this.onchainEnabled && this.onchainAdapter) {
      const startTime = Date.now();
      const adapterType =
        this.configService.get<string>('ONCHAIN_ADAPTER')?.toLowerCase() ||
        'mock';

      try {
        this.logger.log(`Calling on-chain adapter for expired claim ${claim.id}`, {
          claimId: claim.id,
          adapter: adapterType,
        });

        // Determine whether to revoke or refund based on claim status
        if (claim.status === ClaimStatus.verified) {
          // For verified claims, try to refund
          onchainResult = await this.onchainAdapter.refundAidPackage({
            packageId,
            operatorAddress: this.configService.get<string>('ONCHAIN_OPERATOR_ADDRESS') || 'mock-operator',
          });
        } else {
          // For requested claims, just revoke
          onchainResult = await this.onchainAdapter.revokeAidPackage({
            packageId,
            operatorAddress: this.configService.get<string>('ONCHAIN_OPERATOR_ADDRESS') || 'mock-operator',
          });
        }

        const duration = (Date.now() - startTime) / 1000;

        // Record metrics
        const operation = claim.status === ClaimStatus.verified ? 'refund' : 'revoke';
        this.metricsService.incrementOnchainOperation(
          operation,
          adapterType,
          onchainResult.status,
        );
        this.metricsService.recordOnchainDuration(
          operation,
          adapterType,
          duration,
        );

        this.logger.log(`On-chain ${operation} completed for expired claim ${claim.id}`, {
          claimId: claim.id,
          transactionHash: onchainResult.transactionHash,
          status: onchainResult.status,
          duration,
        });

        // Audit log for on-chain operation
        await this.auditService.record({
          actorId: 'system',
          entity: 'onchain',
          entityId: claim.id,
          action: `${operation}_expired_claim`,
          metadata: {
            transactionHash: onchainResult.transactionHash,
            status: onchainResult.status,
            amountRefunded: onchainResult.amountRefunded,
            adapter: adapterType,
            originalStatus: claim.status,
          },
        });

      } catch (error) {
        const duration = (Date.now() - startTime) / 1000;
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(
          `On-chain operation failed for expired claim ${claim.id}: ${errorMessage}`,
          error instanceof Error ? error.stack : undefined,
          'ClaimsService',
          { claimId: claim.id, adapter: adapterType }
        );

        // Record failed metric
        const operation = claim.status === ClaimStatus.verified ? 'refund' : 'revoke';
        this.metricsService.incrementOnchainOperation(
          operation,
          adapterType,
          'failed',
        );
        this.metricsService.recordOnchainDuration(
          operation,
          adapterType,
          duration,
        );

        // Audit log for failed operation
        await this.auditService.record({
          actorId: 'system',
          entity: 'onchain',
          entityId: claim.id,
          action: `${operation}_expired_claim_failed`,
          metadata: {
            error: errorMessage,
            adapter: adapterType,
            originalStatus: claim.status,
          },
        });

        // Don't throw - continue with status transition even if on-chain call fails
      }
    }

    // Update claim status to expired
    await this.prisma.$transaction(async tx => {
      const updatedClaim = await tx.claim.update({
        where: { id: claim.id },
        data: { status: ClaimStatus.expired },
        include: { campaign: true },
      });

      // Audit log for status change
      await this.auditService.record({
        actorId: 'system',
        entity: 'claim',
        entityId: claim.id,
        action: 'status_changed_to_expired',
        metadata: {
          from: claim.status,
          to: ClaimStatus.expired,
          expiredAt: claim.expiresAt,
          onchainResult: onchainResult
            ? {
                transactionHash: onchainResult.transactionHash,
                status: onchainResult.status,
                amountRefunded: onchainResult.amountRefunded,
              }
            : undefined,
        },
      });

      return updatedClaim;
    });

    this.logger.log(`Successfully processed expired claim ${claim.id}`);
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
