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
import { ClaimReceiptDto, SendReceiptShareDto } from './dto/claim-receipt.dto';
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
import { AnalyticsService } from '../analytics/analytics.service';

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
    private readonly analyticsService: AnalyticsService,
  ) {
    this.onchainEnabled =
      this.configService.get<string>('ONCHAIN_ENABLED') === 'true';
  }

  async create(createClaimDto: CreateClaimDto) {
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
      },
      include: {
        campaign: true,
      },
    });

    claim.recipientRef = this.encryptionService.decrypt(claim.recipientRef);

    await this.analyticsService.invalidateAnalyticsCache('claim created');

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

        const packageId = this.generateMockPackageId(id);
        const tokenAddress = this.getTokenAddressForClaim(claim);

        onchainResult = await this.onchainAdapter.disburse({
          claimId: id,
          packageId,
          recipientAddress: this.encryptionService.decrypt(claim.recipientRef),
          amount: claim.amount.toString(),
          tokenAddress,
        });

        const duration = (Date.now() - startTime) / 1000;

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
      }
    }

    return this.transitionStatus(
      id,
      ClaimStatus.approved,
      ClaimStatus.disbursed,
      onchainResult,
    );
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

    const updatedClaim = await this.prisma.$transaction(async tx => {
      const updated = await tx.claim.update({
        where: { id },
        data: { status: toStatus },
        include: { campaign: true },
      });

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

    await this.analyticsService.invalidateAnalyticsCache(
      `claim status changed to ${toStatus}`,
    );

    return updatedClaim;
  }

  private generateMockPackageId(claimId: string): string {
    const hash = createHash('sha256')
      .update(`package-${claimId}`)
      .digest('hex');

    return BigInt(`0x${hash.substring(0, 16)}`).toString();
  }

  private getTokenAddressForClaim(
    claim: {
      metadata?: any;
      campaign?: { metadata?: any } | null;
    } & Record<string, any>,
  ): string {
    const defaultTokenAddress =
      'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN';

    const claimMetadata = claim.metadata as Record<string, unknown> | undefined;

    if (claimMetadata?.tokenAddress) {
      return claimMetadata.tokenAddress as string;
    }

    const campaignMetadata = claim.campaign?.metadata as
      | Record<string, unknown>
      | undefined;

    if (campaignMetadata?.tokenAddress) {
      return campaignMetadata.tokenAddress as string;
    }

    return defaultTokenAddress;
  }

  private auditLog(
    entity: string,
    entityId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ) {
    console.log(`Audit: ${entity} ${entityId} ${action}`, metadata);
  }

  async getReceipt(id: string): Promise<ClaimReceiptDto> {
    const claim = await this.findOne(id);

    if (!claim) {
      throw new NotFoundException('Claim not found');
    }

    const tokenAddress = this.getTokenAddressForClaim(claim);

    return {
      claimId: claim.id,
      packageId: claim.campaignId,
      status: claim.status,
      amount: claim.amount,
      timestamp: claim.createdAt.toISOString(),
      tokenAddress,
      recipientRef: claim.recipientRef,
    };
  }

  async shareReceipt(
    id: string,
    shareDto: SendReceiptShareDto,
  ): Promise<{
    receiptData: string;
    mimeType: string;
    filename: string;
    text: string;
  }> {
    const receipt = await this.getReceipt(id);
    const receiptText = this.generateReceiptText(receipt);
    const filename = `claim-receipt-${receipt.claimId}.txt`;
    const receiptData = Buffer.from(receiptText).toString('base64');

    if (shareDto.channel === 'email' && shareDto.emailAddresses?.length) {
      this.sendReceiptViaEmail(
        shareDto.emailAddresses,
        receipt,
        receiptText,
        shareDto.message ?? undefined,
      );
    } else if (shareDto.channel === 'sms' && shareDto.phoneNumbers?.length) {
      this.sendReceiptViaSMS(
        shareDto.phoneNumbers,
        receipt,
        shareDto.message ?? undefined,
      );
    }

    void this.auditLog('claim', id, 'receipt_shared', {
      channel: shareDto.channel,
      emailCount: shareDto.emailAddresses?.length || 0,
      smsCount: shareDto.phoneNumbers?.length || 0,
    });

    return {
      receiptData,
      mimeType: 'text/plain',
      filename,
      text: receiptText,
    };
  }

  private generateReceiptText(receipt: ClaimReceiptDto): string {
    const lines = [
      '═══════════════════════════════════════',
      '         CLAIM RECEIPT',
      '═══════════════════════════════════════',
      '',
      `Claim ID:        ${receipt.claimId}`,
      `Package ID:      ${receipt.packageId}`,
      `Status:          ${receipt.status.toUpperCase()}`,
      `Amount:          ${receipt.amount} tokens`,
      `Date:            ${receipt.timestamp}`,
    ];

    if (receipt.tokenAddress) {
      lines.push(`Token Address:   ${receipt.tokenAddress}`);
    }

    if (receipt.recipientRef) {
      lines.push(`Recipient:       ${receipt.recipientRef}`);
    }

    lines.push('');
    lines.push('═══════════════════════════════════════');
    lines.push('This is an automated proof of claim');
    lines.push('completion on the Soter platform.');
    lines.push('═══════════════════════════════════════');

    return lines.join('\n');
  }

  private sendReceiptViaEmail(
    emailAddresses: string[],
    receipt: ClaimReceiptDto,
    receiptText: string,
    _message?: string,
  ): void {
    this.logger.log(
      `Sending receipt via email to ${emailAddresses.length} recipient(s)`,
      {
        claimId: receipt.claimId,
        recipients: emailAddresses,
      },
    );

    for (const email of emailAddresses) {
      this.logger.debug(
        `[EMAIL STUB] Would send receipt to ${email}`,
        receiptText.substring(0, 100),
      );
    }
  }

  private sendReceiptViaSMS(
    phoneNumbers: string[],
    receipt: ClaimReceiptDto,
    _message?: string,
  ): void {
    this.logger.log(
      `Sending receipt via SMS to ${phoneNumbers.length} recipient(s)`,
      {
        claimId: receipt.claimId,
        recipients: phoneNumbers,
      },
    );

    const smsText = `Claim ${receipt.claimId} - Status: ${receipt.status} - Amount: ${receipt.amount} tokens`;

    for (const phone of phoneNumbers) {
      this.logger.debug(`[SMS STUB] Would send to ${phone}: ${smsText}`);
    }
  }
}
