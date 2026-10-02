import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  AdminState,
  AdminTransferResult,
  ONCHAIN_ADAPTER_TOKEN,
  OnchainAdapter,
} from './onchain.adapter';
import { ProposeAdminTransferDto } from './dto/admin-transfer.dto';

/**
 * Audit actions recorded for the two-step admin transfer. One entry per leg so
 * the trail shows who proposed, who accepted, and who abandoned a transfer.
 */
export const ADMIN_TRANSFER_AUDIT_ACTIONS = {
  proposed: 'admin_transfer_proposed',
  accepted: 'admin_transfer_accepted',
  cancelled: 'admin_transfer_cancelled',
} as const;

export interface AdminTransferActor {
  actorId: string;
  contractId?: string;
}

/**
 * Drives the contract's two-step admin transfer and records every leg in the
 * tamper-evident audit chain.
 *
 * The contract itself enforces the sequencing: `transfer_admin` only records a
 * nomination, `accept_admin` performs the rotation, and
 * `cancel_admin_transfer` abandons it. This service mirrors that state machine
 * over the adapter and verifies on-chain state after each write, so a proposal
 * that the contract silently ignored can never be reported as successful.
 *
 * All three legs are signed with the adapter's configured admin secret key, so
 * acceptance is only possible while the backend controls the pending admin.
 *
 * The audit entry is written after the on-chain write is confirmed, and a
 * failed audit write is surfaced rather than swallowed — the two-step design
 * means a caller can always re-read state to see whether a leg landed, while a
 * silently dropped audit record would be invisible.
 */
@Injectable()
export class AdminTransferService {
  private readonly logger = new Logger(AdminTransferService.name);

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    private readonly auditService: AuditService,
  ) {}

  async getState(contractId?: string): Promise<AdminState> {
    return this.onchainAdapter.getAdminState({ contractId });
  }

  /**
   * Step one: nominate a new admin. The current admin is unchanged until the
   * nominee calls `acceptAdmin`.
   */
  async propose(
    actor: AdminTransferActor,
    dto: ProposeAdminTransferDto,
  ): Promise<AdminTransferResult> {
    const before = await this.onchainAdapter.getAdminState({
      contractId: actor.contractId,
    });

    if (before.adminAddress && dto.newAdminAddress === before.adminAddress) {
      throw new BadRequestException(
        'InvalidPendingAdmin: the nominated address is already the current admin',
      );
    }

    const result = await this.onchainAdapter.transferAdmin({
      contractId: actor.contractId,
      newAdminAddress: dto.newAdminAddress,
    });

    if (result.pendingAdminAddress !== dto.newAdminAddress) {
      throw new ConflictException(
        `Contract did not record ${dto.newAdminAddress} as the pending admin (reported: ${result.pendingAdminAddress ?? 'none'})`,
      );
    }

    await this.auditService.record({
      actorId: actor.actorId,
      entity: 'AdminTransfer',
      entityId: result.contractId,
      action: ADMIN_TRANSFER_AUDIT_ACTIONS.proposed,
      metadata: {
        previousAdminAddress: before.adminAddress,
        pendingAdminAddress: result.pendingAdminAddress,
        transactionHash: result.transactionHash,
        onChainTimestamp: result.timestamp.toISOString(),
      },
    });

    this.logger.log(
      `Admin transfer proposed for ${result.contractId}: ${before.adminAddress} -> ${result.pendingAdminAddress} (actor=${actor.actorId})`,
    );

    return result;
  }

  /**
   * Step two: the pending admin takes the role, completing the rotation.
   */
  async accept(actor: AdminTransferActor): Promise<AdminTransferResult> {
    const before = await this.onchainAdapter.getAdminState({
      contractId: actor.contractId,
    });

    if (!before.pendingAdminAddress) {
      throw new BadRequestException(
        'NoPendingTransfer: no admin transfer is awaiting acceptance',
      );
    }

    const result = await this.onchainAdapter.acceptAdmin({
      contractId: actor.contractId,
    });

    if (result.pendingAdminAddress !== null) {
      throw new ConflictException(
        `Contract still reports ${result.pendingAdminAddress} as pending admin after acceptance`,
      );
    }

    await this.auditService.record({
      actorId: actor.actorId,
      entity: 'AdminTransfer',
      entityId: result.contractId,
      action: ADMIN_TRANSFER_AUDIT_ACTIONS.accepted,
      metadata: {
        previousAdminAddress: before.adminAddress,
        newAdminAddress: result.adminAddress,
        transactionHash: result.transactionHash,
        onChainTimestamp: result.timestamp.toISOString(),
      },
    });

    this.logger.log(
      `Admin transfer accepted for ${result.contractId}: ${before.adminAddress} -> ${result.adminAddress} (actor=${actor.actorId})`,
    );

    return result;
  }

  /**
   * Abandon a proposal, leaving the current admin in place.
   */
  async cancel(actor: AdminTransferActor): Promise<AdminTransferResult> {
    const before = await this.onchainAdapter.getAdminState({
      contractId: actor.contractId,
    });

    if (!before.pendingAdminAddress) {
      throw new BadRequestException(
        'NoPendingTransfer: no admin transfer is awaiting acceptance',
      );
    }

    const result = await this.onchainAdapter.cancelAdminTransfer({
      contractId: actor.contractId,
    });

    if (result.pendingAdminAddress !== null) {
      throw new ConflictException(
        `Contract still reports ${result.pendingAdminAddress} as pending admin after cancellation`,
      );
    }

    await this.auditService.record({
      actorId: actor.actorId,
      entity: 'AdminTransfer',
      entityId: result.contractId,
      action: ADMIN_TRANSFER_AUDIT_ACTIONS.cancelled,
      metadata: {
        previousAdminAddress: before.adminAddress,
        cancelledPendingAdminAddress: before.pendingAdminAddress,
        remainingAdminAddress: result.adminAddress,
        transactionHash: result.transactionHash,
        onChainTimestamp: result.timestamp.toISOString(),
      },
    });

    this.logger.log(
      `Admin transfer cancelled for ${result.contractId}; ${result.adminAddress} remains admin (actor=${actor.actorId})`,
    );

    return result;
  }
}
