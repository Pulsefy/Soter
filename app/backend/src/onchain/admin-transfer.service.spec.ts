import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  ADMIN_TRANSFER_ACTIONS,
  ADMIN_TRANSFER_AUDIT_ENTITY,
  AdminTransferService,
} from './admin-transfer.service';
import { MockOnchainAdapter } from './onchain.adapter.mock';

describe('AdminTransferService', () => {
  let service: AdminTransferService;
  let adapter: MockOnchainAdapter;
  let audit: { record: jest.Mock };

  /** Matches the mock adapter's default admin, used for the "same address" case. */
  const CURRENT_ADMIN =
    'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ';
  const NEW_ADMIN =
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  beforeEach(() => {
    adapter = new MockOnchainAdapter();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new AdminTransferService(
      adapter,
      audit as unknown as AuditService,
    );
  });

  describe('propose-then-accept', () => {
    it('proposes, accepts and audits both steps with actor and addresses', async () => {
      const proposed = await service.initiateTransfer({
        newAdmin: NEW_ADMIN,
        actorId: 'admin-initiator',
      });

      expect(proposed.status).toBe('success');
      expect(proposed.newAdmin).toBe(NEW_ADMIN);
      expect(proposed.transactionHash).toHaveLength(64);
      expect(proposed.timestamp).toBeInstanceOf(Date);

      await expect(service.getPendingAdmin()).resolves.toMatchObject({
        pendingAdmin: NEW_ADMIN,
      });

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-initiator',
          entity: ADMIN_TRANSFER_AUDIT_ENTITY,
          entityId: NEW_ADMIN,
          action: ADMIN_TRANSFER_ACTIONS.initiated,
          metadata: expect.objectContaining({
            actorId: 'admin-initiator',
            newAdmin: NEW_ADMIN,
            transactionHash: proposed.transactionHash,
            status: 'success',
          }),
        }),
      );

      const accepted = await service.acceptTransfer('admin-acceptor');

      expect(accepted.status).toBe('success');
      expect(accepted.admin).toBe(NEW_ADMIN);
      expect(accepted.transactionHash).toHaveLength(64);

      // The pending slot is cleared once the transfer is accepted.
      await expect(service.getPendingAdmin()).resolves.toMatchObject({
        pendingAdmin: null,
      });

      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actorId: 'admin-acceptor',
          entity: ADMIN_TRANSFER_AUDIT_ENTITY,
          entityId: NEW_ADMIN,
          action: ADMIN_TRANSFER_ACTIONS.accepted,
          metadata: expect.objectContaining({
            actorId: 'admin-acceptor',
            admin: NEW_ADMIN,
            previousPendingAdmin: NEW_ADMIN,
            transactionHash: accepted.transactionHash,
            status: 'success',
          }),
        }),
      );
    });

    it('accepts only after the proposal and rejects a second accept', async () => {
      await service.initiateTransfer({
        newAdmin: NEW_ADMIN,
        actorId: 'admin-initiator',
      });

      await service.acceptTransfer('admin-acceptor');

      await expect(service.acceptTransfer('admin-acceptor')).rejects.toThrow(
        BadRequestException,
      );
      // Only the successful propose + accept are audited.
      expect(audit.record).toHaveBeenCalledTimes(2);
    });
  });

  describe('propose-then-cancel', () => {
    it('proposes, cancels and audits both steps', async () => {
      const proposed = await service.initiateTransfer({
        newAdmin: NEW_ADMIN,
        actorId: 'admin-initiator',
      });
      expect(proposed.newAdmin).toBe(NEW_ADMIN);

      const cancelled = await service.cancelTransfer('admin-canceller');

      expect(cancelled.status).toBe('success');
      expect(cancelled.cancelledAdmin).toBe(NEW_ADMIN);
      expect(cancelled.transactionHash).toHaveLength(64);

      await expect(service.getPendingAdmin()).resolves.toMatchObject({
        pendingAdmin: null,
      });

      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actorId: 'admin-canceller',
          entity: ADMIN_TRANSFER_AUDIT_ENTITY,
          entityId: NEW_ADMIN,
          action: ADMIN_TRANSFER_ACTIONS.cancelled,
          metadata: expect.objectContaining({
            actorId: 'admin-canceller',
            cancelledAdmin: NEW_ADMIN,
            transactionHash: cancelled.transactionHash,
            status: 'success',
          }),
        }),
      );
    });

    it('rejects cancelling when no transfer is in flight and logs nothing', async () => {
      await expect(service.cancelTransfer('admin-canceller')).rejects.toThrow(
        'No pending admin transfer to cancel',
      );
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('rejects an empty newAdmin before touching the adapter', async () => {
      await expect(
        service.initiateTransfer({ newAdmin: '   ', actorId: 'admin' }),
      ).rejects.toThrow('newAdmin is required');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('rejects accepting when no transfer is pending', async () => {
      await expect(service.acceptTransfer('admin')).rejects.toThrow(
        'No pending admin transfer to accept',
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('rejects nominating the address that is already admin', async () => {
      await expect(
        service.initiateTransfer({
          newAdmin: CURRENT_ADMIN,
          actorId: 'admin',
        }),
      ).rejects.toThrow('New admin must differ from the current admin');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('reports no pending admin for a fresh adapter', async () => {
      const result = await service.getPendingAdmin();
      expect(result.pendingAdmin).toBeNull();
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });
});
