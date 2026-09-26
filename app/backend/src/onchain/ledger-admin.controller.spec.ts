import { BadRequestException } from '@nestjs/common';
import { AppRole } from '../auth/app-role.enum';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { LedgerBackfillService } from './ledger-backfill.service';
import { LedgerReconciliationService } from './ledger-reconciliation.service';
import { OnchainAdapter } from './onchain.adapter';
import { LedgerAdminController } from './ledger-admin.controller';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';

describe('LedgerAdminController action pause controls', () => {
  const backfillService = {} as LedgerBackfillService;
  const reconciliationService = {} as LedgerReconciliationService;
  const lifecycleService = {} as SorobanTransactionLifecycleService;
  const onchainAdapter = {
    pauseAction: jest.fn().mockResolvedValue(undefined),
    unpauseAction: jest.fn().mockResolvedValue(undefined),
  } as unknown as OnchainAdapter;
  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  let controller: LedgerAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new LedgerAdminController(
      backfillService,
      reconciliationService,
      lifecycleService,
      onchainAdapter,
      auditService,
    );
  });

  it('requires the admin role for action pause routes', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, LedgerAdminController.prototype.pauseAction),
    ).toEqual([AppRole.admin]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        LedgerAdminController.prototype.unpauseAction,
      ),
    ).toEqual([AppRole.admin]);
  });

  it('pauses a valid action and records the authenticated actor', async () => {
    const request = {
      user: { id: 'admin-123' },
    } as Parameters<LedgerAdminController['pauseAction']>[1];

    await expect(controller.pauseAction('claim', request)).resolves.toEqual({
      success: true,
      action: 'claim',
      paused: true,
    });
    expect(onchainAdapter.pauseAction).toHaveBeenCalledWith('claim');
    expect(auditService.record).toHaveBeenCalledWith({
      actorId: 'admin-123',
      entity: 'onchain_action',
      entityId: 'claim',
      action: 'pause',
      metadata: { action: 'claim', paused: true },
    });
  });

  it('unpauses a valid action and records the operation', async () => {
    const request = {
      user: { sub: 'admin-456' },
    } as Parameters<LedgerAdminController['unpauseAction']>[1];

    await controller.unpauseAction('refund', request);

    expect(onchainAdapter.unpauseAction).toHaveBeenCalledWith('refund');
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-456',
        entityId: 'refund',
        action: 'unpause',
      }),
    );
  });

  it('rejects unsupported actions without submitting or auditing', async () => {
    const request = {} as Parameters<LedgerAdminController['pauseAction']>[1];

    await expect(controller.pauseAction('invalid', request)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(onchainAdapter.pauseAction).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });
});