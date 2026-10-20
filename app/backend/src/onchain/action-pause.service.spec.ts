import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  ActionPauseService,
  ACTION_PAUSE_AUDIT_ACTIONS,
} from './action-pause.service';
import { MockOnchainAdapter } from './onchain.adapter.mock';
import { AppException } from '../common/constants/integration-error-codes';
import { AdminActionLogger } from '../audit/admin-action-logger.service';

const PACKAGE = {
  operatorAddress: `G${'A'.repeat(55)}`,
  packageId: 'pkg-1',
  recipientAddress: `G${'B'.repeat(55)}`,
  amount: '100',
  tokenAddress: `C${'C'.repeat(55)}`,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};

describe('ActionPauseService', () => {
  let adapter: MockOnchainAdapter;
  let auditService: { record: jest.Mock };
  let service: ActionPauseService;

  beforeEach(() => {
    adapter = new MockOnchainAdapter();
    auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    service = new ActionPauseService(
      adapter,
      new AdminActionLogger(auditService as never),
    );
  });

  describe('pausing one action', () => {
    it('blocks only that action while others remain active', async () => {
      const result = await service.pause({ actorId: 'ops-1' }, 'claim');

      expect(result).toMatchObject({
        action: 'claim',
        isPaused: true,
        globallyPaused: false,
      });
      expect(result.transactionHash).toHaveLength(64);

      const status = await service.getStatus();
      expect(status.globallyPaused).toBe(false);
      expect(status.actions).toEqual({
        create: false,
        claim: true,
        withdraw: false,
        refund: false,
      });

      // The paused action is rejected with the mapped ContractPaused error...
      await expect(
        adapter.claimAidPackage({
          packageId: PACKAGE.packageId,
          recipientAddress: PACKAGE.recipientAddress,
        }),
      ).rejects.toMatchObject({
        errorCode: 'ONCHAIN_CONTRACT_PAUSED',
      });
      // ...while a different action still goes through.
      await expect(adapter.createAidPackage(PACKAGE)).resolves.toMatchObject({
        status: 'success',
      });
    });

    it('restores the action on unpause', async () => {
      await service.pause({ actorId: 'ops-1' }, 'claim');
      const result = await service.unpause({ actorId: 'ops-1' }, 'claim');

      expect(result).toMatchObject({
        action: 'claim',
        isPaused: false,
        globallyPaused: false,
      });
      await expect(adapter.isActionPaused('claim')).resolves.toBe(false);
    });

    it('records each change in the audit chain', async () => {
      await service.pause({ actorId: 'ops-1' }, 'refund');
      await service.unpause({ actorId: 'ops-2' }, 'refund');

      expect(auditService.record).toHaveBeenCalledTimes(2);
      expect(auditService.record.mock.calls[0][0]).toMatchObject({
        actorId: 'ops-1',
        entity: 'ContractActionPause',
        entityId: 'refund',
        action: ACTION_PAUSE_AUDIT_ACTIONS.paused,
        metadata: {
          target: { type: 'contract_action', id: 'refund' },
          before: { isPaused: false, globallyPaused: false },
          after: { isPaused: true, globallyPaused: false },
          correlationId: null,
          outcome: 'success',
          severity: 'info',
        },
      });
      expect(auditService.record.mock.calls[1][0]).toMatchObject({
        actorId: 'ops-2',
        action: ACTION_PAUSE_AUDIT_ACTIONS.unpaused,
        metadata: {
          before: { isPaused: true, globallyPaused: false },
          after: { isPaused: false, globallyPaused: false },
          outcome: 'success',
          severity: 'info',
        },
      });
    });
  });

  describe('global pause precedence', () => {
    it('reports every action as paused while globally paused', async () => {
      adapter.mockGloballyPaused = true;

      const status = await service.getStatus();
      expect(status.globallyPaused).toBe(true);
      expect(Object.values(status.actions)).toEqual([true, true, true, true]);
      await expect(adapter.createAidPackage(PACKAGE)).rejects.toBeInstanceOf(
        AppException,
      );
    });

    it('keeps an unpaused action blocked until the global pause lifts', async () => {
      await service.pause({ actorId: 'ops-1' }, 'claim');
      adapter.mockGloballyPaused = true;

      const result = await service.unpause({ actorId: 'ops-1' }, 'claim');
      expect(result).toMatchObject({ isPaused: true, globallyPaused: true });
      expect(auditService.record).toHaveBeenLastCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ globallyPaused: true }),
        }),
      );

      adapter.mockGloballyPaused = false;
      await expect(adapter.isActionPaused('claim')).resolves.toBe(false);
    });
  });

  describe('validation and verification', () => {
    it('rejects an unknown action without touching the contract', async () => {
      const spy = jest.spyOn(adapter, 'pauseAction');

      await expect(
        service.pause({ actorId: 'ops-1' }, 'disburse'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(spy).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ACTION_PAUSE_AUDIT_ACTIONS.paused,
          metadata: expect.objectContaining({
            outcome: 'rejected',
            severity: 'warn',
            after: null,
          }),
        }),
      );
    });

    it('refuses to report a pause the contract did not record', async () => {
      jest.spyOn(adapter, 'pauseAction').mockResolvedValue({
        action: 'claim',
        transactionHash: 'HASH',
        isPaused: false,
        timestamp: new Date(),
      });

      await expect(
        service.pause({ actorId: 'ops-1' }, 'claim'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ACTION_PAUSE_AUDIT_ACTIONS.paused,
          metadata: expect.objectContaining({
            outcome: 'rejected',
            after: null,
          }),
        }),
      );
    });

    it('refuses to report an unpause the contract ignored', async () => {
      jest.spyOn(adapter, 'unpauseAction').mockResolvedValue({
        action: 'claim',
        transactionHash: 'HASH',
        isPaused: true,
        timestamp: new Date(),
      });

      await expect(
        service.unpause({ actorId: 'ops-1' }, 'claim'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ACTION_PAUSE_AUDIT_ACTIONS.unpaused,
          metadata: expect.objectContaining({
            outcome: 'rejected',
            after: null,
          }),
        }),
      );
    });
  });
});
