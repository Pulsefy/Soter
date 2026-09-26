import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AcceptAdminResult,
  CancelAdminTransferResult,
  ONCHAIN_ADAPTER_TOKEN,
  OnchainAdapter,
  TransferAdminResult,
} from './onchain.adapter';
import { AuditService } from '../audit/audit.service';

/** Audit entity used for every two-step admin transfer entry. */
export const ADMIN_TRANSFER_AUDIT_ENTITY = 'aid_escrow_admin';

/** Audit actions written for each step of the two-step transfer. */
export const ADMIN_TRANSFER_ACTIONS = {
  initiated: 'admin_transfer.initiated',
  accepted: 'admin_transfer.accepted',
  cancelled: 'admin_transfer.cancelled',
} as const;

export interface InitiateAdminTransferInput {
  /** Stellar address to nominate as the next contract admin. */
  newAdmin: string;
  /** Authenticated operator that requested the transfer. */
  actorId: string;
}

export interface PendingAdminResult {
  pendingAdmin: string | null;
  timestamp: Date;
}

/**
 * Orchestrates the contract's two-step admin transfer and mirrors each step
 * into the application audit log.
 *
 * The Soroban contract exposes `transfer_admin` (propose), `accept_admin`
 * (confirm) and `cancel_admin_transfer` (abort). Before this service existed
 * none of the three could be reached from the backend, so an admin rotation
 * happened entirely outside the application with no audit trail.
 */
@Injectable()
export class AdminTransferService {
  private readonly logger = new Logger(AdminTransferService.name);

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly adapter: OnchainAdapter,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Step 1 — propose `newAdmin`. Writes `admin_transfer.initiated` to the
   * audit log with the actor, the addresses involved and the contract tx hash.
   */
  async initiateTransfer(
    input: InitiateAdminTransferInput,
  ): Promise<TransferAdminResult> {
    const newAdmin = (input.newAdmin || '').trim();
    if (!newAdmin) {
      throw new BadRequestException('newAdmin is required');
    }

    const result = await this.adapter.transferAdmin({ newAdmin });

    await this.recordAudit({
      actorId: input.actorId,
      entityId: result.newAdmin || newAdmin,
      action: ADMIN_TRANSFER_ACTIONS.initiated,
      metadata: {
        actorId: input.actorId,
        newAdmin: result.newAdmin || newAdmin,
        transactionHash: result.transactionHash,
        timestamp: result.timestamp.toISOString(),
        status: result.status,
      },
    });

    return result;
  }

  /**
   * Step 2 — accept the in-flight transfer. Reads the pending admin first so
   * the audit entry can name both the accepting actor and the address that
   * takes over the admin role.
   */
  async acceptTransfer(actorId: string): Promise<AcceptAdminResult> {
    const pendingAdmin = await this.adapter.getPendingAdmin();
    if (!pendingAdmin) {
      throw new BadRequestException('No pending admin transfer to accept');
    }

    const result = await this.adapter.acceptAdmin();
    const admin = result.admin || pendingAdmin;

    await this.recordAudit({
      actorId,
      entityId: admin,
      action: ADMIN_TRANSFER_ACTIONS.accepted,
      metadata: {
        actorId,
        admin,
        previousPendingAdmin: pendingAdmin,
        transactionHash: result.transactionHash,
        timestamp: result.timestamp.toISOString(),
        status: result.status,
      },
    });

    return result;
  }

  /**
   * Abort an in-flight transfer before it is accepted.
   */
  async cancelTransfer(actorId: string): Promise<CancelAdminTransferResult> {
    const pendingAdmin = await this.adapter.getPendingAdmin();
    if (!pendingAdmin) {
      throw new BadRequestException('No pending admin transfer to cancel');
    }

    const result = await this.adapter.cancelAdminTransfer();
    const cancelledAdmin = result.cancelledAdmin || pendingAdmin;

    await this.recordAudit({
      actorId,
      entityId: cancelledAdmin,
      action: ADMIN_TRANSFER_ACTIONS.cancelled,
      metadata: {
        actorId,
        cancelledAdmin,
        transactionHash: result.transactionHash,
        timestamp: result.timestamp.toISOString(),
        status: result.status,
      },
    });

    return result;
  }

  async getPendingAdmin(): Promise<PendingAdminResult> {
    return {
      pendingAdmin: await this.adapter.getPendingAdmin(),
      timestamp: new Date(),
    };
  }

  private async recordAudit(params: {
    actorId: string;
    entityId: string;
    action: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.auditService.record({
      actorId: params.actorId,
      entity: ADMIN_TRANSFER_AUDIT_ENTITY,
      entityId: params.entityId,
      action: params.action,
      metadata: params.metadata,
    });
    this.logger.log(
      `${params.action} entity=${ADMIN_TRANSFER_AUDIT_ENTITY} actor=${params.actorId}`,
    );
  }
}
