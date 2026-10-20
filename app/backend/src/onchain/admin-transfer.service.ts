import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { AdminActionLogger } from '../audit/admin-action-logger.service';
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
  correlationId?: string | null;
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
  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    private readonly adminActionLogger: AdminActionLogger,
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
    let before: AdminState | null = null;
    let contractId = actor.contractId;
    let transactionHash: string | null = null;
    return this.adminActionLogger.execute(
      {
        actor: actor.actorId,
        action: ADMIN_TRANSFER_AUDIT_ACTIONS.proposed,
        target: () =>
          contractId ? { type: 'AdminTransfer', id: contractId } : null,
        before: () =>
          before
            ? {
                adminAddress: before.adminAddress,
                pendingAdminAddress: before.pendingAdminAddress,
              }
            : null,
          details: () => (transactionHash ? { transactionHash } : null),
        correlationId: actor.correlationId ?? null,
      },
      async () => {
        before = await this.onchainAdapter.getAdminState({
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
        contractId = result.contractId;
        transactionHash = result.transactionHash;

        if (result.pendingAdminAddress !== dto.newAdminAddress) {
          throw new ConflictException(
            `Contract did not record ${dto.newAdminAddress} as the pending admin (reported: ${result.pendingAdminAddress ?? 'none'})`,
          );
        }
        return result;
      },
      result => ({
        adminAddress: result.adminAddress,
        pendingAdminAddress: result.pendingAdminAddress,
      }),
    );
  }

  /**
   * Step two: the pending admin takes the role, completing the rotation.
   */
  async accept(actor: AdminTransferActor): Promise<AdminTransferResult> {
    let before: AdminState | null = null;
    let contractId = actor.contractId;
    let transactionHash: string | null = null;
    return this.adminActionLogger.execute(
      {
        actor: actor.actorId,
        action: ADMIN_TRANSFER_AUDIT_ACTIONS.accepted,
        target: () =>
          contractId ? { type: 'AdminTransfer', id: contractId } : null,
        before: () =>
          before
            ? {
                adminAddress: before.adminAddress,
                pendingAdminAddress: before.pendingAdminAddress,
              }
            : null,
          details: () => (transactionHash ? { transactionHash } : null),
        correlationId: actor.correlationId ?? null,
      },
      async () => {
        before = await this.onchainAdapter.getAdminState({
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
        contractId = result.contractId;
        transactionHash = result.transactionHash;
        if (result.pendingAdminAddress !== null) {
          throw new ConflictException(
            `Contract still reports ${result.pendingAdminAddress} as pending admin after acceptance`,
          );
        }
        return result;
      },
      result => ({
        adminAddress: result.adminAddress,
        pendingAdminAddress: result.pendingAdminAddress,
      }),
    );
  }

  /**
   * Abandon a proposal, leaving the current admin in place.
   */
  async cancel(actor: AdminTransferActor): Promise<AdminTransferResult> {
    let before: AdminState | null = null;
    let contractId = actor.contractId;
    let transactionHash: string | null = null;
    return this.adminActionLogger.execute(
      {
        actor: actor.actorId,
        action: ADMIN_TRANSFER_AUDIT_ACTIONS.cancelled,
        target: () =>
          contractId ? { type: 'AdminTransfer', id: contractId } : null,
        before: () =>
          before
            ? {
                adminAddress: before.adminAddress,
                pendingAdminAddress: before.pendingAdminAddress,
              }
            : null,
          details: () => (transactionHash ? { transactionHash } : null),
        correlationId: actor.correlationId ?? null,
      },
      async () => {
        before = await this.onchainAdapter.getAdminState({
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
        contractId = result.contractId;
        transactionHash = result.transactionHash;
        if (result.pendingAdminAddress !== null) {
          throw new ConflictException(
            `Contract still reports ${result.pendingAdminAddress} as pending admin after cancellation`,
          );
        }
        return result;
      },
      result => ({
        adminAddress: result.adminAddress,
        pendingAdminAddress: result.pendingAdminAddress,
      }),
    );
  }
}
