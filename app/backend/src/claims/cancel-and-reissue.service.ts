import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { BudgetAlertsService } from '../campaigns/budget-alerts.service';
import { CancelClaimDto } from './dto/cancel-claim.dto';
import { ReissueClaimDto } from './dto/reissue-claim.dto';
import { ClaimStatus } from '@prisma/client';
import {
  CLAIM_EVENT,
  ClaimCancelledEvent,
  ClaimReissuedEvent,
} from './claim.events';

/** Statuses from which a claim may be cancelled. */
const CANCELLABLE_STATUSES: ClaimStatus[] = [
  ClaimStatus.requested,
  ClaimStatus.verified,
  ClaimStatus.approved,
];

@Injectable()
export class CancelAndReissueService {
  private readonly logger = new Logger(CancelAndReissueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly encryptionService: EncryptionService,
    private readonly budgetAlertsService: BudgetAlertsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  /**
   * Cancel an active claim.
   *
   * - Marks the claim as `cancelled` and records who cancelled it and why.
   * - Writes an `unlock` entry to BalanceLedger so the campaign budget is freed.
   * - Emits a `claim.cancelled` audit event with the full relationship context.
   *
   * Disbursed or already-cancelled claims cannot be cancelled.
   */
  async cancel(id: string, dto: CancelClaimDto) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: { campaign: true },
    });

    if (!claim || claim.deletedAt) {
      throw new NotFoundException('Claim not found');
    }

    if (claim.status === ClaimStatus.cancelled) {
      throw new BadRequestException('Claim is already cancelled');
    }

    if (!CANCELLABLE_STATUSES.includes(claim.status)) {
      throw new BadRequestException(
        `Cannot cancel a claim in status "${claim.status}". ` +
          `Only ${CANCELLABLE_STATUSES.join(', ')} claims may be cancelled.`,
      );
    }

    const now = new Date();

    const cancelled = await this.prisma.$transaction(async tx => {
      // 1. Mark claim as cancelled
      const updated = await tx.claim.update({
        where: { id },
        data: {
          status: ClaimStatus.cancelled,
          cancelledAt: now,
          cancelledBy: dto.operatorId,
          cancelReason: dto.reason ?? null,
        },
        include: { campaign: true },
      });

      // 2. Release the locked balance back to the campaign
      await tx.balanceLedger.create({
        data: {
          campaignId: claim.campaignId,
          claimId: id,
          eventType: 'unlock',
          // Negative amount: this entry reduces the total locked balance
          amount: -claim.amount,
          note: `Claim ${id} cancelled by ${dto.operatorId}. Reason: ${dto.reason ?? 'none'}`,
        },
      });

      return updated;
    });

    // 3. Emit domain event via audit trail
    const event: ClaimCancelledEvent = {
      type: CLAIM_EVENT.CANCELLED,
      claimId: id,
      campaignId: claim.campaignId,
      operatorId: dto.operatorId,
      reason: dto.reason,
      unlockedAmount: claim.amount,
      timestamp: now,
    };

    await this.emitEvent(event);

    this.logger.log(`Claim ${id} cancelled by ${dto.operatorId}`, {
      claimId: id,
      campaignId: claim.campaignId,
      amount: claim.amount,
    });

    // Check budget thresholds after balance changes
    void this.budgetAlertsService.checkThresholds(claim.campaignId);

    return {
      ...cancelled,
      recipientRef: this.encryptionService.decrypt(cancelled.recipientRef),
    };
  }

  // ---------------------------------------------------------------------------
  // Reissue
  // ---------------------------------------------------------------------------

  /**
   * Cancel an existing claim and atomically create a replacement.
   *
   * - The original claim must be in a cancellable status.
   * - The new claim inherits the original's campaign, recipient, and amount
   *   unless overrides are provided in the DTO.
   * - `reissuedFromId` on the new claim links it back to the original,
   *   preserving the full audit chain.
   * - A single DB transaction ensures the old claim is cancelled and the new
   *   one is created together — no double-counting of locked balances.
   * - Emits both `claim.cancelled` and `claim.reissued` audit events.
   */
  async reissue(originalId: string, dto: ReissueClaimDto) {
    const original = await this.prisma.claim.findUnique({
      where: { id: originalId },
      include: { campaign: true },
    });

    if (!original || original.deletedAt) {
      throw new NotFoundException('Original claim not found');
    }

    if (original.status === ClaimStatus.cancelled) {
      throw new BadRequestException('Original claim is already cancelled');
    }

    if (!CANCELLABLE_STATUSES.includes(original.status)) {
      throw new BadRequestException(
        `Cannot reissue from a claim in status "${original.status}". ` +
          `Only ${CANCELLABLE_STATUSES.join(', ')} claims may be reissued.`,
      );
    }

    const newAmount = dto.amount ?? original.amount;
    const newRecipientRef = dto.recipientRef
      ? this.encryptionService.encrypt(dto.recipientRef)
      : original.recipientRef; // already encrypted

    const now = new Date();

    const { cancelledClaim, newClaim } = await this.prisma.$transaction(
      async tx => {
        // 1. Cancel the original claim
        const cancelledClaim = await tx.claim.update({
          where: { id: originalId },
          data: {
            status: ClaimStatus.cancelled,
            cancelledAt: now,
            cancelledBy: dto.operatorId,
            cancelReason: dto.reason ?? `Reissued as new claim`,
          },
        });

        // 2. Unlock the original amount from the campaign budget
        await tx.balanceLedger.create({
          data: {
            campaignId: original.campaignId,
            claimId: originalId,
            eventType: 'unlock',
            amount: -original.amount,
            note: `Claim ${originalId} cancelled for reissue by ${dto.operatorId}`,
          },
        });

        // 3. Create the replacement claim, linked to the original
        const newClaim = await tx.claim.create({
          data: {
            campaignId: original.campaignId,
            amount: newAmount,
            recipientRef: newRecipientRef,
            evidenceRef: original.evidenceRef,
            status: ClaimStatus.requested,
            reissuedFromId: originalId,
          },
          include: { campaign: true },
        });

        // 4. Lock the new amount against the campaign budget
        await tx.balanceLedger.create({
          data: {
            campaignId: original.campaignId,
            claimId: newClaim.id,
            eventType: 'lock',
            amount: newAmount,
            note: `Replacement claim ${newClaim.id} issued by ${dto.operatorId} (replaces ${originalId})`,
          },
        });

        return { cancelledClaim, newClaim };
      },
    );

    // 5. Emit domain events via audit trail
    const cancelEvent: ClaimCancelledEvent = {
      type: CLAIM_EVENT.CANCELLED,
      claimId: originalId,
      campaignId: original.campaignId,
      operatorId: dto.operatorId,
      reason: dto.reason ?? `Reissued as ${newClaim.id}`,
      unlockedAmount: original.amount,
      timestamp: now,
    };

    const reissueEvent: ClaimReissuedEvent = {
      type: CLAIM_EVENT.REISSUED,
      newClaimId: newClaim.id,
      originalClaimId: originalId,
      campaignId: original.campaignId,
      operatorId: dto.operatorId,
      amount: newAmount,
      reason: dto.reason,
      timestamp: now,
    };

    // Emit both events; fire-and-forget is intentional — audit failures
    // must not roll back the already-committed transaction.
    await Promise.all([
      this.emitEvent(cancelEvent),
      this.emitEvent(reissueEvent),
    ]);

    this.logger.log(
      `Claim ${originalId} cancelled and reissued as ${newClaim.id} by ${dto.operatorId}`,
      {
        originalId,
        newClaimId: newClaim.id,
        campaignId: original.campaignId,
        originalAmount: original.amount,
        newAmount,
      },
    );

    return {
      original: {
        ...cancelledClaim,
        recipientRef: this.encryptionService.decrypt(
          cancelledClaim.recipientRef,
        ),
      },
      replacement: {
        ...newClaim,
        recipientRef: this.encryptionService.decrypt(newClaim.recipientRef),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Reissue history
  // ---------------------------------------------------------------------------

  /**
   * Walk the reissue chain for a given claim ID and return every claim in the
   * lineage, ordered from oldest to newest.
   *
   * Works in both directions: pass any claim in the chain and the full history
   * is returned.
   */
  async getReissueHistory(id: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim || claim.deletedAt) {
      throw new NotFoundException('Claim not found');
    }

    // Walk backwards to find the root of the chain
    const root = await this.findChainRoot(id);

    // Walk forwards from root to collect all descendants
    const chain = await this.collectChain(root);

    return chain.map(c => ({
      ...c,
      recipientRef: this.encryptionService.decrypt(c.recipientRef),
    }));
  }

  // ---------------------------------------------------------------------------
  // Locked balance summary
  // ---------------------------------------------------------------------------

  /**
   * Return the current locked balance for a campaign by summing all
   * BalanceLedger entries.
   *
   * - `lockedAmount`  = sum of all 'lock' entries minus sum of all 'unlock' entries
   * - `disbursedAmount` = sum of all 'disburse' entries
   * - `availableBudget` = campaign.budget - lockedAmount - disbursedAmount
   */
  async getCampaignBalance(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || campaign.deletedAt) {
      throw new NotFoundException('Campaign not found');
    }

    const ledger = await this.prisma.balanceLedger.findMany({
      where: { campaignId },
    });

    let lockedAmount = 0;
    let disbursedAmount = 0;

    for (const entry of ledger) {
      if (entry.eventType === 'lock' || entry.eventType === 'unlock') {
        lockedAmount += entry.amount; // unlock entries have negative amounts
      } else if (entry.eventType === 'disburse') {
        disbursedAmount += entry.amount;
      }
    }

    const availableBudget = campaign.budget - lockedAmount - disbursedAmount;

    return {
      campaignId,
      budget: campaign.budget,
      lockedAmount,
      disbursedAmount,
      availableBudget,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async findChainRoot(id: string): Promise<string> {
    let current = await this.prisma.claim.findUnique({
      where: { id },
      select: { id: true, reissuedFromId: true },
    });

    while (current?.reissuedFromId) {
      current = await this.prisma.claim.findUnique({
        where: { id: current.reissuedFromId },
        select: { id: true, reissuedFromId: true },
      });
    }

    return current?.id ?? id;
  }

  private async collectChain(rootId: string) {
    const results: Awaited<ReturnType<typeof this.prisma.claim.findUnique>>[] =
      [];

    const root = await this.prisma.claim.findUnique({
      where: { id: rootId },
      include: { campaign: true },
    });
    if (!root) return [];

    results.push(root);

    // BFS over reissuedTo children
    const queue = [rootId];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const children = await this.prisma.claim.findMany({
        where: { reissuedFromId: parentId },
        include: { campaign: true },
        orderBy: { createdAt: 'asc' },
      });
      for (const child of children) {
        results.push(child);
        queue.push(child.id);
      }
    }

    return results.filter(Boolean) as NonNullable<(typeof results)[number]>[];
  }

  /**
   * Persist a domain event to the AuditLog.
   * The metadata field carries the full typed event payload so downstream
   * consumers (reporting, compliance) can reconstruct the relationship graph.
   */
  private async emitEvent(
    event: ClaimCancelledEvent | ClaimReissuedEvent,
  ): Promise<void> {
    try {
      const entityId =
        event.type === CLAIM_EVENT.REISSUED ? event.newClaimId : event.claimId;

      await this.auditService.record({
        actorId: event.operatorId,
        entity: 'claim',
        entityId,
        action: event.type,
        metadata: event as unknown as Record<string, unknown>,
      });
    } catch (err) {
      // Audit failures are logged but must not surface to the caller
      this.logger.error(
        `Failed to emit event ${event.type}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
