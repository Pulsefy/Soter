import { AppException, ERROR_CODES } from '../../common/dto/error-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Subset of PrismaClient/TransactionClient this service relies on. */
type PrismaLike = Pick<
  Prisma.TransactionClient,
  'campaign' | 'balanceLedger' | '$queryRaw'
>;

@Injectable()
export class BudgetService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the total locked and disbursed amount for a campaign.
   * Optionally filter by token if your model supports it.
   */
  async getCampaignBudgetUsage(
    campaignId: string,
  ): Promise<{ locked: number; disbursed: number }> {
    // Sum all locked amounts
    const locked = await this.prisma.balanceLedger.aggregate({
      _sum: { amount: true },
      where: {
        campaignId,
        eventType: 'lock',
      },
    });
    // Sum all disbursed amounts
    const disbursed = await this.prisma.balanceLedger.aggregate({
      _sum: { amount: true },
      where: {
        campaignId,
        eventType: 'disburse',
      },
    });
    return {
      locked: locked._sum.amount || 0,
      disbursed: disbursed._sum.amount || 0,
    };
  }

  /**
   * Throws if the new lock/disburse would exceed the campaign budget.
   *
   * NOTE: this performs a plain read-then-compare and is only safe when the
   * caller does not need protection against a concurrent caller doing the
   * same check for the same campaign at (roughly) the same time â€” e.g.
   * one-off/administrative checks. Anything that creates a lock/disburse
   * entry as a result of this check (claim creation, disbursement) MUST use
   * `reserveBudget` instead, inside the same transaction that writes the
   * ledger entry, or the check can be bypassed by concurrent requests.
   */
  async assertWithinBudget(campaignId: string, newAmount: number) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign)
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        'Campaign not found',
      );
    const usage = await this.getCampaignBudgetUsage(campaignId);
    const total = usage.locked + usage.disbursed + newAmount;
    if (total > campaign.budget) {
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        'Campaign funding cap exceeded',
      );
    }
  }

  /**
   * Transaction-safe budget check for use inside a `prisma.$transaction`.
   *
   * Takes a row lock on the campaign (`SELECT ... FOR UPDATE`) before
   * summing locked + disbursed amounts, so concurrent callers attempting to
   * reserve budget against the *same campaign* are serialized: the second
   * transaction blocks at the lock until the first commits (or rolls back),
   * and then re-reads the up-to-date ledger totals before deciding.
   *
   * The caller is responsible for writing the corresponding `lock` (or
   * `disburse`) BalanceLedger entry inside the same transaction, so that the
   * next reservation attempt sees this one's usage.
   *
   * Throws BadRequestException if the campaign doesn't exist or the
   * reservation would exceed the campaign's budget.
   */
  async reserveBudget(
    tx: PrismaLike,
    campaignId: string,
    newAmount: number,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string; budget: number }>>(
      Prisma.sql`SELECT "id", "budget" FROM "Campaign" WHERE "id" = ${campaignId} FOR UPDATE`,
    );
    const campaign = rows[0];
    if (!campaign)
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        'Campaign not found',
      );

    const [locked, disbursed] = await Promise.all([
      tx.balanceLedger.aggregate({
        _sum: { amount: true },
        where: { campaignId, eventType: 'lock' },
      }),
      tx.balanceLedger.aggregate({
        _sum: { amount: true },
        where: { campaignId, eventType: 'disburse' },
      }),
    ]);

    const total =
      (locked._sum.amount || 0) + (disbursed._sum.amount || 0) + newAmount;

    if (total > campaign.budget) {
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        'Campaign funding cap exceeded',
      );
    }
  }
}
