import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Optional,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ClaimReceiptDto, SendReceiptShareDto } from './dto/claim-receipt.dto';
import { explorerTxUrl } from '../common/utils/explorer-url.util';
import { ExportClaimsQueryDto } from './dto/export-claims.dto';
import {
  ClaimStatus,
  Prisma,
  SorobanOperationType,
  SorobanTransaction,
} from '@prisma/client';
import {
  OnchainAdapter,
  DisburseResult,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';
import { LoggerService } from '../logger/logger.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { BudgetService } from '../common/budget/budget.service';
import { SorobanTransactionLifecycleService } from '../onchain/soroban-transaction-lifecycle.service';
import { SorobanTransactionScheduler } from '../onchain/soroban-transaction.scheduler';
import { escapeCsvField, toCsvRow } from '../common/csv/csv.util';
import { streamCursorPaginated } from '../common/streaming/cursor-paginate';

export interface ClaimExportRow {
  id: string;
  campaignId: string;
  campaignName: string;
  status: string;
  amount: number;
  evidenceRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  reissuedFromId: string | null;
  tokenAddress: string | null;
}

interface RawClaimExportRow {
  id: string;
  campaignId: string;
  campaign: {
    name: string;
    metadata: unknown;
  } | null;
  status: ClaimStatus;
  amount: number;
  evidenceRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  reissuedFromId: string | null;
  metadata: unknown;
}

type ExpirationCleanupCapableAdapter = OnchainAdapter & {
  revokeAidPackage?: (params: {
    packageId: string;
    operatorAddress: string;
  }) => Promise<{
    transactionHash: string;
    status: 'success' | 'failed';
  }>;
  refundAidPackage?: (params: {
    packageId: string;
    operatorAddress: string;
  }) => Promise<{
    transactionHash: string;
    status: 'success' | 'failed';
    amountRefunded?: string;
  }>;
};

const DEFAULT_CLAIM_EXPIRY_DAYS = 30;

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
    private readonly budgetService: BudgetService,
    private readonly sorobanTransactionService: SorobanTransactionLifecycleService,
    private readonly sorobanTransactionScheduler: SorobanTransactionScheduler,
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

    await this.budgetService.assertWithinBudget(
      createClaimDto.campaignId,
      createClaimDto.amount,
    );

    const claim = await this.prisma.claim.create({
      data: {
        campaignId: createClaimDto.campaignId,
        amount: createClaimDto.amount,
        recipientRef: this.encryptionService.encrypt(
          createClaimDto.recipientRef,
        ),
        evidenceRef: createClaimDto.evidenceRef,
        importJobId: createClaimDto.importJobId,
        importRowNumber: createClaimDto.importRowNumber,
        expiresAt:
          createClaimDto.expiresAt ??
          new Date(
            Date.now() + DEFAULT_CLAIM_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
          ),
      },
      include: {
        campaign: true,
      },
    });

    claim.recipientRef = this.encryptionService.decrypt(claim.recipientRef);

    void this.auditLog('claim', claim.id, 'created', {
      status: claim.status,
      tokenAddress: createClaimDto.tokenAddress,
    });

    this.metricsService.incrementClaimsCreated(campaign.id);
    this.metricsService.adjustClaimsInFunnel('requested', 1);

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
    const claimResult = await this.prisma.claim.findUnique({
      where: { id },
      include: {
        campaign: true,
      },
    });
    const claim = claimResult;
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

  async disburse(id: string, receiptPointer?: string) {
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

    if (receiptPointer) {
      await this.prisma.claim.update({
        where: { id },
        data: { receiptPointer },
      });
    }

    let sorobanTransaction: SorobanTransaction | undefined;
    if (this.onchainEnabled && this.onchainAdapter) {
      const packageId = this.generateMockPackageId(id);
      const tokenAddress = this.getTokenAddressForClaim(claim);
      const correlationId = `disburse-${id}-${Date.now()}`;

      sorobanTransaction =
        await this.sorobanTransactionService.createTransaction({
          claimId: id,
          operation: SorobanOperationType.disburse_claim,
          packageId,
          operatorAddress: 'admin',
          recipientAddress: this.encryptionService.decrypt(claim.recipientRef),
          amount: claim.amount.toString(),
          tokenAddress,
          correlationId,
          metadata: {
            campaignId: claim.campaignId,
            claimAmount: claim.amount,
            originalClaimStatus: claim.status,
            receiptPointer,
          },
          maxAttempts: 5,
        });

      await this.sorobanTransactionScheduler.scheduleTransaction(
        sorobanTransaction.id,
        {
          correlationId,
          priority: 1,
        },
      );

      this.logger.log(
        'Created Soroban transaction with lifecycle tracking for claim disbursement',
        {
          claimId: id,
          transactionId: sorobanTransaction.id,
          packageId,
          correlationId,
          receiptPointer,
        },
      );

      this.metricsService.incrementCounter('soroban_disbursement_scheduled', {
        claimId: id,
        transactionId: sorobanTransaction.id,
      });
    }

    const updatedClaim = await this.transitionStatus(
      id,
      ClaimStatus.approved,
      ClaimStatus.disbursed,
    );

    this.logger.log(
      `Claim ${id} marked as disbursed with Soroban transaction tracking`,
      {
        claimId: id,
        sorobanTransactionId: sorobanTransaction?.id,
        receiptPointer,
      },
    );

    return updatedClaim;
  }

  private generateMockPackageId(claimId: string): string {
    const hash = createHash('sha256')
      .update(`package-${claimId}`)
      .digest('hex');
    return BigInt('0x' + hash.substring(0, 16)).toString();
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
      Record<string, unknown> | undefined;
    if (campaignMetadata?.tokenAddress) {
      return campaignMetadata.tokenAddress as string;
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

  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredClaimsCron(): Promise<void> {
    try {
      await this.cleanupExpiredClaims();
      await this.refreshFunnelGauges();
    } catch (error) {
      this.logger.error(
        'Failed to clean up expired claims',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async cleanupExpiredClaims(now: Date = new Date()): Promise<{
    processed: number;
    archived: number;
  }> {
    const expiredClaims = await this.prisma.claim.findMany({
      where: {
        deletedAt: null,
        status: {
          in: [ClaimStatus.requested, ClaimStatus.verified],
        },
        expiresAt: {
          lt: now,
        },
      },
    });

    if (expiredClaims.length === 0) {
      this.logger.log('No expired claims found for cleanup');
      return { processed: 0, archived: 0 };
    }

    let archived = 0;

    for (const claim of expiredClaims) {
      const onchainMetadata = await this.cleanupExpiredClaimOnchain(claim.id);

      await this.prisma.claim.update({
        where: { id: claim.id },
        data: { status: ClaimStatus.archived },
      });

      await this.auditService.record({
        actorId: 'system',
        entity: 'claim',
        entityId: claim.id,
        action: 'expired_cleanup',
        metadata: {
          previousStatus: claim.status,
          nextStatus: ClaimStatus.archived,
          expiresAt: claim.expiresAt?.toISOString() ?? null,
          onchain: onchainMetadata,
        },
      });

      archived += 1;
    }

    this.logger.log(
      `Expired claim cleanup completed: archived ${archived} claim(s)`,
    );

    return {
      processed: expiredClaims.length,
      archived,
    };
  }

  async refreshFunnelGauges(): Promise<void> {
    const statuses = [
      ClaimStatus.requested,
      ClaimStatus.verified,
      ClaimStatus.approved,
      ClaimStatus.disbursed,
      ClaimStatus.archived,
      ClaimStatus.cancelled,
    ];

    const counts = await Promise.all(
      statuses.map(status =>
        this.prisma.claim
          .count({
            where: { status, deletedAt: null },
          })
          .then(count => ({ status, count })),
      ),
    );

    for (const { status, count } of counts) {
      this.metricsService.setClaimsInFunnel(status, count);
    }
  }

  private async cleanupExpiredClaimOnchain(claimId: string): Promise<{
    attempted: boolean;
    revoked?: string;
    refunded?: string;
    skippedReason?: string;
  }> {
    if (!this.onchainEnabled || !this.onchainAdapter) {
      return {
        attempted: false,
        skippedReason: 'onchain_disabled',
      };
    }

    const cleanupAdapter = this
      .onchainAdapter as ExpirationCleanupCapableAdapter;

    if (!cleanupAdapter.revokeAidPackage || !cleanupAdapter.refundAidPackage) {
      return {
        attempted: false,
        skippedReason: 'adapter_missing_cleanup_methods',
      };
    }

    const packageId = this.generateMockPackageId(claimId);

    const revokeResult = await cleanupAdapter.revokeAidPackage({
      packageId,
      operatorAddress: 'system',
    });
    const refundResult = await cleanupAdapter.refundAidPackage({
      packageId,
      operatorAddress: 'system',
    });

    return {
      attempted: true,
      revoked: revokeResult.transactionHash,
      refunded: refundResult.transactionHash,
    };
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

    const durationSeconds = (Date.now() - claim.updatedAt.getTime()) / 1000;

    const campaignId = claim.campaignId;

    if (toStatus === ClaimStatus.verified) {
      this.metricsService.incrementClaimsVerified(campaignId);
    } else if (toStatus === ClaimStatus.approved) {
      this.metricsService.incrementClaimsApproved(campaignId);
    } else if (toStatus === ClaimStatus.disbursed) {
      this.metricsService.incrementClaimsDisbursed(
        campaignId,
        this.onchainEnabled ?? false,
      );
    }

    this.metricsService.recordClaimFunnelDuration(
      fromStatus,
      toStatus,
      durationSeconds,
    );
    this.metricsService.adjustClaimsInFunnel(fromStatus, -1);
    this.metricsService.adjustClaimsInFunnel(toStatus, 1);

    return updatedClaim;
  }

  private auditLog(
    entity: string,
    entityId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ) {
    console.log(`Audit: ${entity} ${entityId} ${action}`, metadata);
  }

  private buildExplorerLink(transactionHash: string): string | null {
    const network =
      this.configService.get<string>('STELLAR_NETWORK')?.toLowerCase() ??
      'testnet';
    const explorerBase =
      this.configService.get<string>('STELLAR_EXPLORER_URL') ??
      'https://stellar.expert/explorer';
    if (network === 'mainnet' || network === 'pubnet') {
      return `${explorerBase}/public/tx/${transactionHash}`;
    }
    return `${explorerBase}/testnet/tx/${transactionHash}`;
  }

  private async resolveClaimByIdentifier(identifier: string): Promise<any> {
    try {
      const directClaim = await this.findOne(identifier);
      if (directClaim) return directClaim;
    } catch {
      // not found via claim ID - fall through
    }

    const claimsForPackage = await this.prisma.claim.findMany({
      where: {
        deletedAt: null,
        campaignId: identifier,
      },
      include: { campaign: true },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    if (claimsForPackage.length > 0) {
      const match = claimsForPackage[0];
      return {
        ...match,
        recipientRef: this.encryptionService.decrypt(match.recipientRef),
      };
    }

    throw new NotFoundException('Claim not found');
  }

  private async findDisbursementTransaction(
    claimId: string,
  ): Promise<{ transactionHash: string; status: string } | null> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        entity: 'onchain',
        entityId: claimId,
        action: 'disburse',
      },
      orderBy: { timestamp: 'desc' },
      take: 1,
    });
    if (logs.length === 0) return null;
    const metadata = logs[0].metadata as Record<string, any> | null;
    if (!metadata?.transactionHash) return null;
    return {
      transactionHash: metadata.transactionHash,
      status: metadata.status ?? 'success',
    };
  }

  async getReceipt(identifier: string): Promise<ClaimReceiptDto> {
    const claim = await this.resolveClaimByIdentifier(identifier);

    if (!claim) {
      throw new NotFoundException('Claim not found');
    }

    const tokenAddress = this.getTokenAddressForClaim(claim);

    const txInfo = await this.findDisbursementTransaction(claim.id);
    const transactionHash = txInfo?.transactionHash;
    const explorerLink = transactionHash
      ? (this.buildExplorerLink(transactionHash) ?? undefined)
      : undefined;

    const timeline = await this.buildTimeline(claim.id);

    return {
      claimId: claim.id,
      packageId: claim.campaignId,
      status: claim.status,
      amount: claim.amount,
      timestamp: claim.createdAt.toISOString(),
      tokenAddress,
      recipientRef: claim.recipientRef,
      transactionHash,
      explorerLink,
      timeline,
    };
  }

  private async buildTimeline(claimId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: { entityId: claimId, entity: 'claim' },
      orderBy: { timestamp: 'asc' },
    });

    return logs
      .filter(log => log.action.startsWith('status_changed_to_'))
      .map(log => {
        const metadata = log.metadata as Record<string, any> | null;
        const txHash = metadata?.transactionHash as string | undefined;
        const network =
          this.configService.get<string>('STELLAR_NETWORK') ?? 'testnet';
        return {
          status: log.action.replace('status_changed_to_', ''),
          timestamp: log.timestamp.toISOString(),
          transactionHash: txHash,
          explorerUrl: txHash ? explorerTxUrl(txHash, network) : undefined,
        };
      });
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

    if (receipt.transactionHash) {
      lines.push(`Transaction:     ${receipt.transactionHash}`);
    }

    if (receipt.explorerLink) {
      lines.push(`Explorer:        ${receipt.explorerLink}`);
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

  private static readonly EXPORT_BATCH_SIZE = 500;

  private static readonly CSV_HEADER =
    'id,campaignId,campaignName,status,amount,evidenceRef,createdAt,updatedAt,cancelledAt,cancelledBy,cancelReason,reissuedFromId,tokenAddress';

  private buildExportWhere(
    query: ExportClaimsQueryDto,
  ): Prisma.ClaimWhereInput {
    const where: Prisma.ClaimWhereInput = {
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.campaignId) where.campaignId = query.campaignId;

    if (query.from || query.to) {
      if (query.from && isNaN(Date.parse(query.from))) {
        throw new BadRequestException(`Invalid 'from' date: ${query.from}`);
      }
      if (query.to && isNaN(Date.parse(query.to))) {
        throw new BadRequestException(`Invalid 'to' date: ${query.to}`);
      }
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    if (query.orgId) {
      where.campaign = { orgId: query.orgId };
    }

    if (query.tokenAddress) {
      where.OR = [
        {
          campaign: {
            metadata: { path: ['tokenAddress'], equals: query.tokenAddress },
          },
        },
      ];
    }

    return where;
  }

  private mapClaimRow(c: RawClaimExportRow): ClaimExportRow {
    const claimMetadata = c.metadata as Record<string, unknown> | undefined;
    const campaignMetadata = c.campaign?.metadata as
      Record<string, unknown> | undefined;

    return {
      id: c.id,
      campaignId: c.campaignId,
      campaignName: c.campaign?.name ?? '',
      status: c.status,
      amount: c.amount,
      evidenceRef: c.evidenceRef ?? null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      cancelledAt: c.cancelledAt ?? null,
      cancelledBy: c.cancelledBy ?? null,
      cancelReason: c.cancelReason ?? null,
      reissuedFromId: c.reissuedFromId ?? null,
      tokenAddress: (claimMetadata?.tokenAddress ??
        campaignMetadata?.tokenAddress ??
        null) as string | null,
    };
  }

  async countExport(query: ExportClaimsQueryDto): Promise<number> {
    return this.prisma.claim.count({ where: this.buildExportWhere(query) });
  }

  async *streamExportRows(
    query: ExportClaimsQueryDto,
  ): AsyncGenerator<ClaimExportRow> {
    const where = this.buildExportWhere(query);
    const batchSize = ClaimsService.EXPORT_BATCH_SIZE;

    const fetchPage = (cursor: string | undefined) =>
      this.prisma.claim.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { campaign: true },
      }) as unknown as Promise<RawClaimExportRow[]>;

    for await (const row of streamCursorPaginated(fetchPage, batchSize)) {
      yield this.mapClaimRow(row);
    }
  }

  async *streamExportCsv(query: ExportClaimsQueryDto): AsyncGenerator<string> {
    yield ClaimsService.CSV_HEADER + '\r\n';

    for await (const row of this.streamExportRows(query)) {
      yield toCsvRow([
        escapeCsvField(row.id),
        escapeCsvField(row.campaignId),
        escapeCsvField(row.campaignName),
        escapeCsvField(row.status),
        escapeCsvField(row.amount.toFixed(2)),
        escapeCsvField(row.evidenceRef),
        escapeCsvField(row.createdAt.toISOString()),
        escapeCsvField(row.updatedAt.toISOString()),
        escapeCsvField(row.cancelledAt?.toISOString() ?? ''),
        escapeCsvField(row.cancelledBy),
        escapeCsvField(row.cancelReason),
        escapeCsvField(row.reissuedFromId),
        escapeCsvField(row.tokenAddress),
      ]);
    }
  }
}
