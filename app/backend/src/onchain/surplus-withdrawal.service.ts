import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  ONCHAIN_ADAPTER_TOKEN,
  OnchainAdapter,
  PendingWithdrawal,
  SurplusWithdrawalStatus,
} from './onchain.adapter';
import { timelockRemainingSeconds } from './utils/pending-withdrawal';
import { SurplusWithdrawalTimelockNotElapsedError } from './utils/surplus-withdrawal.errors';
import { ProposeSurplusWithdrawalDto } from './dto/surplus-withdrawal.dto';

/**
 * Audit actions recorded for the timelocked surplus withdrawal. One entry per
 * leg so the trail shows who proposed, who cancelled, and who released the
 * funds — the delay window is only useful if it is attributable.
 */
export const SURPLUS_WITHDRAWAL_AUDIT_ACTIONS = {
  proposed: 'surplus_withdrawal_proposed',
  cancelled: 'surplus_withdrawal_cancelled',
  executed: 'surplus_withdrawal_executed',
} as const;

export interface SurplusWithdrawalActor {
  actorId: string;
  contractId?: string;
}

/**
 * Drives the contract's timelocked surplus withdrawal and records every leg in
 * the tamper-evident audit chain.
 *
 * The contract enforces the sequencing: `propose_surplus_withdrawal` records
 * the intent and starts the delay, `execute_surplus_withdrawal` transfers the
 * funds once the delay has elapsed, and `cancel_surplus_withdrawal` abandons
 * the proposal without moving anything. This service mirrors that state machine
 * over the adapter and re-reads on-chain state after every write, so a proposal
 * the contract silently ignored can never be reported as successful.
 *
 * All legs are signed with the adapter's configured admin secret key, so the
 * delay window cannot be bypassed by switching to a different signer.
 */
@Injectable()
export class SurplusWithdrawalService {
  private readonly logger = new Logger(SurplusWithdrawalService.name);

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Read the pending proposal and how long is left on its timelock.
   *
   * This is the endpoint an operator polls during the delay window, so it never
   * mutates anything.
   */
  async getStatus(contractId?: string): Promise<SurplusWithdrawalStatus> {
    const pending = await this.onchainAdapter.getPendingWithdrawal({
      contractId,
    });

    return {
      contractId: contractId ?? '',
      pendingWithdrawal: pending,
      timelockRemainingSeconds: timelockRemainingSeconds(pending),
      timestamp: new Date(),
    };
  }

  /**
   * Step one: record the intent to withdraw and start the timelock. No funds
   * move until `execute`.
   */
  async propose(
    actor: SurplusWithdrawalActor,
    dto: ProposeSurplusWithdrawalDto,
  ): Promise<SurplusWithdrawalStatus> {
    const before = await this.onchainAdapter.getPendingWithdrawal({
      contractId: actor.contractId,
    });

    if (before) {
      throw new ConflictException(
        `A surplus withdrawal is already pending: ${before.amount} of ${before.token} to ${before.to}, executable at ledger timestamp ${before.executableAt}. Cancel it before proposing another.`,
      );
    }

    const result = await this.onchainAdapter.proposeSurplusWithdrawal({
      contractId: actor.contractId,
      to: dto.to,
      amount: dto.amount,
      token: dto.token,
    });

    const pending = result.pendingWithdrawal;
    if (!pending) {
      throw new ConflictException(
        'Contract did not record a pending surplus withdrawal after propose',
      );
    }
    if (
      pending.to !== dto.to ||
      pending.token !== dto.token ||
      pending.amount !== dto.amount
    ) {
      throw new ConflictException(
        `Contract recorded a different proposal than submitted (reported: ${pending.amount} of ${pending.token} to ${pending.to})`,
      );
    }

    await this.auditService.record({
      actorId: actor.actorId,
      entity: 'SurplusWithdrawal',
      entityId: result.contractId,
      action: SURPLUS_WITHDRAWAL_AUDIT_ACTIONS.proposed,
      metadata: {
        to: pending.to,
        token: pending.token,
        amount: pending.amount,
        executableAt: pending.executableAt,
        timelockRemainingSeconds: timelockRemainingSeconds(pending),
        transactionHash: result.transactionHash,
        onChainTimestamp: result.timestamp.toISOString(),
      },
    });

    this.logger.log(
      `Surplus withdrawal proposed for ${result.contractId}: ${pending.amount} of ${pending.token} to ${pending.to}, executable at ${pending.executableAt} (actor=${actor.actorId})`,
    );

    return {
      contractId: result.contractId,
      pendingWithdrawal: pending,
      timelockRemainingSeconds: timelockRemainingSeconds(pending),
      timestamp: result.timestamp,
    };
  }

  /**
   * Abandon a pending proposal. Nothing is transferred.
   */
  async cancel(actor: SurplusWithdrawalActor): Promise<SurplusWithdrawalStatus> {
    const before = await this.onchainAdapter.getPendingWithdrawal({
      contractId: actor.contractId,
    });

    if (!before) {
      throw new BadRequestException(
        'SurplusWithdrawalNotPending: no surplus withdrawal proposal is awaiting execution',
      );
    }

    const result = await this.onchainAdapter.cancelSurplusWithdrawal({
      contractId: actor.contractId,
    });

    if (result.pendingWithdrawal) {
      throw new ConflictException(
        `Contract still reports ${result.pendingWithdrawal.amount} to ${result.pendingWithdrawal.to} as pending after cancellation`,
      );
    }

    await this.auditService.record({
      actorId: actor.actorId,
      entity: 'SurplusWithdrawal',
      entityId: result.contractId,
      action: SURPLUS_WITHDRAWAL_AUDIT_ACTIONS.cancelled,
      metadata: {
        cancelledTo: before.to,
        cancelledToken: before.token,
        cancelledAmount: before.amount,
        cancelledExecutableAt: before.executableAt,
        transactionHash: result.transactionHash,
        onChainTimestamp: result.timestamp.toISOString(),
      },
    });

    this.logger.log(
      `Surplus withdrawal cancelled for ${result.contractId}: ${before.amount} of ${before.token} to ${before.to} (actor=${actor.actorId})`,
    );

    return {
      contractId: result.contractId,
      pendingWithdrawal: null,
      timelockRemainingSeconds: 0,
      timestamp: result.timestamp,
    };
  }

  /**
   * Step two: release the funds, once the delay has elapsed.
   *
   * A premature attempt is reported as a distinct conflict carrying the wait,
   * rather than surfacing as an opaque contract failure.
   */
  async execute(actor: SurplusWithdrawalActor): Promise<SurplusWithdrawalStatus> {
    const before = await this.onchainAdapter.getPendingWithdrawal({
      contractId: actor.contractId,
    });

    if (!before) {
      throw new BadRequestException(
        'SurplusWithdrawalNotPending: no surplus withdrawal proposal is awaiting execution',
      );
    }

    const remaining = timelockRemainingSeconds(before);
    if (remaining > 0) {
      throw this.timelockConflict(before, remaining);
    }

    let result;
    try {
      result = await this.onchainAdapter.executeSurplusWithdrawal({
        contractId: actor.contractId,
      });
    } catch (error) {
      if (error instanceof SurplusWithdrawalTimelockNotElapsedError) {
        throw this.timelockConflict(before, remaining);
      }
      throw error;
    }

    if (result.pendingWithdrawal) {
      throw new ConflictException(
        `Contract still reports ${result.pendingWithdrawal.amount} to ${result.pendingWithdrawal.to} as pending after execution`,
      );
    }

    await this.auditService.record({
      actorId: actor.actorId,
      entity: 'SurplusWithdrawal',
      entityId: result.contractId,
      action: SURPLUS_WITHDRAWAL_AUDIT_ACTIONS.executed,
      metadata: {
        executedTo: before.to,
        executedToken: before.token,
        executedAmount: before.amount,
        transactionHash: result.transactionHash,
        onChainTimestamp: result.timestamp.toISOString(),
      },
    });

    this.logger.log(
      `Surplus withdrawal executed for ${result.contractId}: ${before.amount} of ${before.token} to ${before.to} (actor=${actor.actorId})`,
    );

    return {
      contractId: result.contractId,
      pendingWithdrawal: null,
      timelockRemainingSeconds: 0,
      timestamp: result.timestamp,
    };
  }

  /**
   * Build the distinct "come back later" response.
   *
   * Carries the remaining wait and the ledger timestamp the proposal becomes
   * executable at, so a caller can schedule the retry without a second read.
   */
  private timelockConflict(
    pending: PendingWithdrawal,
    remainingSeconds: number,
  ): ConflictException {
    return new ConflictException({
      error: 'Conflict',
      code: 'SURPLUS_WITHDRAWAL_TIMELOCK_ACTIVE',
      message:
        `SurplusWithdrawalTimelockActive: the withdrawal of ${pending.amount} to ` +
        `${pending.to} cannot execute for another ${remainingSeconds}s ` +
        `(executable at ledger timestamp ${pending.executableAt})`,
      remainingSeconds,
      executableAt: pending.executableAt,
    });
  }
}
