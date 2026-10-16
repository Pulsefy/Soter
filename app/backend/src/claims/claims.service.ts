import { AppException, ERROR_CODES } from '../common/dto/error-response.dto';
import { Injectable, Optional, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ClaimReceiptDto, SendReceiptShareDto } from './dto/claim-receipt.dto';
import { explorerTxUrl } from '../common/utils/explorer-url.util';
import { ExportClaimsQueryDto } from './dto/export-claims.dto';
import {
  CancelReasonCode,
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
import { VerificationService } from '../verification/verification.service';
import { readPersistedVerificationResult } from '../verification/verification-result.persistence';

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
  cancelReasonCode: string | null;
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
  cancelReasonCode: CancelReasonCode | null;
  cancelReason: string | null;
  reissuedFromId: string | null;
  metadata: unknown;
}

type ClaimWithCampaign = Prisma.ClaimGetPayload<{
  include: { campaign: true };
}>;

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

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

export const CAMPAIGN_CONFIDENCE_THRESHOLD_KEY = 'confidenceThreshold';

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
    private readonly verificationService: VerificationService,
  ) {
    this.onchainEnabled =
      this.configService.get<string>('ONCHAIN_ENABLED') === 'true';
  }

  /**
   * Resolve the confidence/fraud threshold to apply to a claim.
   *
   * A campaign may carry an optional `confidenceThreshold` override in its
   * anchor metadata. When present (and a valid number within [0, 1]) it takes
   * precedence over the global default; otherwise the global default is used
   * unchanged so existing campaigns keep their current behaviour.
   */
  getConfidenceThresholdForCampaign(
    campaign?: { metadata?: unknown } | null,
  ): number {
    const globalDefault = this.getGlobalConfidenceThreshold();
    const metadata = campaign?.metadata as
      | Record<string, unknown>
      | undefined;

    const rawOverride = metadata?.[CAMPAIGN_CONFIDENCE_THRESHOLD_KEY];
    const override =
      typeof rawOverride === 'string' ? Number(rawOverride) : rawOverride;
    if (
      typeof override === 'number' &&
      Number.isFinite(override) &&
      override >= 0 &&
      override <= 1
    ) {
      return override;
    }

    return globalDefault;
  }

  private getGlobalConfidenceThreshold(): number {
    const configured = this.configService.get<string>(
      'DEFAULT_CONFIDENCE_THRESHOLD',
    );
    if (configured === undefined || configured === null || configured === '') {
      return DEFAULT_CONFIDENCE_THRESHOLD;
    }
    const parsed = Number(configured);
    return Number.isFinite(parsed) ? parsed : DEFAULT_CONFIDENCE_THRESHOLD;
  }

  async create(createClaimDto: CreateClaimDto) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: createClaimDto.campaignId },
    });
    if (!campaign) {
      throw new AppException(ERROR_CODES.NOT_FOUND, 404, 'Campaign not found');
    }

    // Resolve the campaign-scoped threshold once at creation time so the
    // verification pipeline judges this claim against the campaign's own
    // risk profile (falling back to the global default when unset).
    const confidenceThreshold =
      this.getConfidenceThresholdForCampaign(campaign);

    // Budget enforcement + claim creation + ledger entry that records the
    // new lock all happen inside one transaction. reserveBudget() takes
    // a row lock on the campaign first, so two concurrent creates against
    // the same campaign are serialized here rather than racing on a
    // read-then-write: the second transaction blocks until the first
    // commits its `lock` ledger entry, and only then re-sums usage.
    const claim = await this.prisma.$transaction(async tx => {
      await this.budgetService.reserveBudget(
        tx,
        createClaimDto.campaignId,
        createClaimDto.amount,
      );

      const created = await tx.claim.create({
        data: {
          campaignId: createClaimDto.campaignId,
          amount: createClaimDto.amount,
          recipientRef: this.encryptionService.encrypt(
            createClaimDto.recipientRef,
          ),
          evidenceRef: createClaimDto.evidenceRef,
          importJobId: createClaimDto.importJobId,
          importRowNumber: createClaimDto.importRowNumber,
          anchorMetadata: {
            confidenceThreshold,
          },
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

      await tx.balanceLedger.create({
        data: {
          campaignId: createClaimDto.campaignId,
          claimId: created.id,
          eventType: 'lock',
          amount: created.amount,
          note: `Claim ${created.id} created; locked against campaign budget`,
        },
      });

      return created;
    });

    claim.recipientRef = this.encryptionService.decrypt(claim.recipientRef);

    void this.auditLog('claim', claim.id, 'created', {
      status: claim.status,
      tokenAddress: createClaimDto.tokenAddress,
    });

    this.metricsService.incrementClaimsCreated(campaign.id);
    this.metricsService.adjustClaimsInFunnel('requested', 1);

    this.loggerService.log(
      `Claim ${claim.id} created with confidence threshold ${confidenceThreshold}`,
      'ClaimsService',
      {
        claimId: claim.id,
        campaignId: campaign.id,
        confidenceThreshold,
      },
    );

    await this.enqueueVerificationForClaim(claim.id);

    return claim;
  }

  /**
   * Hand a freshly created claim to the AI verification pipeline.
   *
   * The claim is already durable by the time this runs, so a queue outage must
   * not fail the request: the claim stays in `requested` without a
   * verification record, which is exactly the state reconciliation reports on.
   */
  private async enqueueVerificationForClaim(claimId: string): Promise<void> {
    try {
      await this.verificationService.enqueueVerification(claimId);
    } catch (error) {
      this.loggerService.error(
        `Failed to enqueue verification for claim ${claimId}`,
        error instanceof Error ? error.message : String(error),
      );
    }
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
      verification: readPersistedVerificationResult(claim.anchorMetadata),
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
      throw new AppException(ERROR_CODES.NOT_FOUND, 404, 'Claim not found');
    }
    return {
      ...claim,
      recipientRef: this.encryptionService.decrypt(claim.recipientRef),
      verification: readPersistedVerificationResult(claim.anchorMetadata),
    };
  }

  /**
   * Transition a claim to `verified`.
   *
   * This is no longer a standalone status flip. The verification pipeline
   * writes its outcome onto the claim, and this method only applies that
   * outcome, so a claim with no completed verification record - or one whose
   * score did not clear the threshold - cannot be marked verified.
   */
  async verify(id: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) {
      throw new AppException(ERROR_CODES.NOT_FOUND, 404, 'Claim not found');
    }

    const verification = readPersistedVerificationResult(claim.anchorMetadata);

    if (!verification) {
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        `Claim ${id} has no completed verification record. Verification is queued automatically when a claim is created; wait for it to complete before verifying.`,
      );
    }

    if (!verification.passed) {
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        `Claim ${id} did not pass verification (score ${verification.score} below threshold ${verification.threshold}) and cannot be marked verified.`,
      );
    }

    if (claim.status === ClaimStatus.verified) {
      // The pipeline already applied the same outcome - keep the call
      // idempotent instead of failing on a no-op transition.
      return this.findOne(id);
    }

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

  /**
   * Mark a claim as disbursed and, when on-chain execution is enabled, create
   * the Soroban transaction that performs the transfer.
   *
   * `correlationId` is the trace ID of the request (or job) driving the
   * disbursement. It is stored on the Soroban transaction record and
   */
  async disburse(id: string, correlationId?: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: { campaign: true },
    });
    if (!claim) {
      throw new AppException(ERROR_CODES.NOT_FOUND, 404, 'Claim not found');
    }

    if (claim.status === ClaimStatus.disbursed) {
      return this.findOne(id);
    }

    if (claim.status !== ClaimStatus.approved) {
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        `Claim ${id} must be approved before disbursement (current status: ${claim.status})`,
      );
    }

    if (!this.onchainEnabled || !this.onchainAdapter) {
      return this.transitionStatus(
        id,
        ClaimStatus.approved,
        ClaimStatus.disbursed,
      );
    }

    const disburseResult: DisburseResult = await this.onchainAdapter.disburse({
      claimId: claim.id,
      campaignId: claim.campaignId,
      amount: claim.amount,
      recipientRef: this.encryptionService.decrypt(claim.recipientRef),
    });

    const transaction = await this.sorobanTransactionService.create({
      claimId: claim.id,
      campaignId: claim.campaignId,
      operationType: SorobanOperationType.disburse,
      transactionHash: disburseResult.transactionHash,
      correlationId,
    });

    await this.sorobanTransactionScheduler.schedule(transaction.id);

    return this.transitionStatus(
      id,
      ClaimStatus.approved,
      ClaimStatus.disbursed,
    );
  }

  async cancel(
    id: string,
    cancelBy: string,
    cancelReasonCode: CancelReasonCode,
    cancelReason?: string,
  ) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) {
      throw new AppException(ERROR_CODES.NOT_FOUND, 404, 'Claim not found');
    }

    if (claim.status === ClaimStatus.cancelled) {
      return this.findOne(id);
    }

    if (claim.status === ClaimStatus.disbursed) {
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        `Claim ${id} is already disbursed and cannot be cancelled`,
      );
    }

    return this.prisma.$transaction(async tx => {
      await this.budgetService.releaseBudget(tx, claim.campaignId, claim.amount);

      const updated = await tx.claim.update({
        where: { id },
        data: {
          status: ClaimStatus.cancelled,
          cancelledAt: new Date(),
          cancelledBy: cancelBy,
          cancelReasonCode,
          cancelReason,
        },
      });

      await tx.balanceLedger.create({
        data: {
          campaignId: claim.campaignId,
          claimId: claim.id,
          eventType: 'release',
          amount: claim.amount,
          note: `Claim ${claim.id} cancelled; budget released`,
        },
      });

      return updated;
    });
  }

  async reissue(id: string, createClaimDto: CreateClaimDto) {
    const original = await this.prisma.claim.findUnique({ where: { id } });
    if (!original) {
      throw new AppException(ERROR_CODES.NOT_FOUND, 404, 'Claim not found');
    }

    const created = await this.create(createClaimDto);
    return this.prisma.claim.update({
      where: { id: created.id },
      data: { reissuedFromId: id },
    });
  }

  async getReceipt(id: string): Promise<ClaimReceiptDto> {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: { campaign: true },
    });
    if (!claim) {
      throw new AppException(ERROR_CODES.NOT_FOUND, 404, 'Claim not found');
    }

    const transaction = await this.prisma.sorobanTransaction.findFirst({
      where: { claimId: id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      id: claim.id,
      status: claim.status,
      amount: claim.amount,
      campaignName: claim.campaign.name,
      createdAt: claim.createdAt,
      transactionHash: transaction?.transactionHash ?? null,
      explorerUrl: transaction?.transactionHash
        ? explorerTxUrl(transaction.transactionHash)
        : null,
    };
  }

  async shareReceipt(id: string, dto: SendReceiptShareDto) {
    const receipt = await this.getReceipt(id);
    // The share audit trail is deliberately minimal: we record who shared
    // what and where, but never the recipient reference or other PII.
    void this.auditLog('claim', id, 'receipt-shared', {
      channel: dto.channel,
      recipient: dto.recipient,
    });
    return receipt;
  }

  async exportClaimsQuery(query: ExportClaimsQueryDto) {
    const where: Prisma.ClaimWhereInput = {
      deletedAt: null,
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const rows = await this.prisma.claim.findMany({
      where,
      include: { campaign: true },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(row => this.toExportRow(row as unknown as RawClaimExportRow));
  }

  async streamClaimsExport(
    query: ExportClaimsQueryDto,
    on: (chunk: string) => void,
  ): Promise<void> {
    const where: Prisma.ClaimWhereInput = {
      deletedAt: null,
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const header = toCsvRow([
      'id',
      'campaignId',
      'campaignName',
      'status',
      'amount',
      'evidenceRef',
      'createdAt',
      'updatedAt',
      'cancelledAt',
      'cancelledBy',
      'cancelReasonCode',
      'cancelReason',
      'reissuedFromId',
      'tokenAddress',
    ]);
    on(header);

    await streamCursorPaginated({
      fetch: async cursor =>
        this.prisma.claim.findMany({
          where,
          include: { campaign: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 500,
          ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
        }),
      onBatch: async rows => {
        const chunk = rows
          .map(row => this.toExportRow(row as unknown as RawClaimExportRow))
          .map(row =>
            toCsuRow([
              row.id,
              row.campaignId,
              row.campaignName,
              row.status,
              String(row.amount),
              row.evidenceRef ?? '',
              row.createdAt.toISOString(),
              row.updatedAt.toISOString(),
              row.cancelledAt?.toISOString() ?? '',
              row.cancelledBy ?? '',
              row.cancelReasonCode ?? '',
              row.cancelReason ?? '',
              row.reissuedFromId ?? '',
              row.tokenAddress ?? '',
            ]),
          )
          .join('');
        if (chunk.length > 0) {
          on(chunk);
        }
      },
    });
  }

  private toExportRow(row: RawClaimExportRow): ClaimExportRow {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      campaignId: row.campaignId,
      campaignName: row.campaign?.name ?? '',
      status: row.status,
      amount: row.amount,
      evidenceRef: row.evidenceRef,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      cancelledAt: row.cancelledAt,
      cancelledBy: row.cancelledBy,
      cancelReasonCode: row.cancelReasonCode,
      cancelReason: row.cancelReason,
      reissuedFromId: row.reissuedFromId,
      tokenAddress: (metadata.tokenAddress as string) ?? null,
    };
  }

  private async transitionStatus(
    id: string,
    from: ClaimStatus,
    to: ClaimStatus,
  ) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) {
      throw new AppException(ERROR_CODES.NOT_FOUND, 404, 'Claim not found');
    }
    if (claim.status !== from) {
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        `Claim ${id} cannot transition from ${claim.status} to ${to}`,
      );
    }
    return this.prisma.claim.update({ where: { id }, data: { status: to } });
  }

  private async auditLog(
    entityType: string,
    entityId: string,
    action: string,
    details?: Record<string, unknown>,
  ) {
    try {
      await this.auditService.log(entityType, entityId, action, details);
    } catch (error) {
      this.logger.error(
        `Audit log failed for ${entityType} ${entityId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredClaims() {
    const now = new Date();
    const expired = await this.prisma.claim.findMany({
      where: {
        status: { in: [ClaimStatus.requested, ClaimStatus.verified, ClaimStatus.approved] },
        expiresAt: { lt: now },
        deletedAt: null,
      },
    });

    for (const claim of expired) {
      try {
        await this.cancel(
          claim.id,
          'system',
          CancelReasonCode.expired,
          'Claim expired',
        );
      } catch (error) {
        this.logger.error(
          `Failed to cancel expired claim ${claim.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
