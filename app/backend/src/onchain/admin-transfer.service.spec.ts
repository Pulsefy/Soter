import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  AdminTransferService,
  ADMIN_TRANSFER_AUDIT_ACTIONS,
} from './admin-transfer.service';
import { AdminTransferResult, OnchainAdapter } from './onchain.adapter';
import { MockOnchainAdapter } from './onchain.adapter.mock';

const CURRENT_ADMIN =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const NEW_ADMIN = `G${'B'.repeat(55)}`;

const CONTRACT_ID = 'CDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEAD';

describe('AdminTransferService', () => {
  let adapter: MockOnchainAdapter;
  let auditService: { record: jest.Mock };
  let service: AdminTransferService;

  beforeEach(() => {
    adapter = new MockOnchainAdapter();
    auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    service = new AdminTransferService(adapter, auditService as never);
  });

  describe('propose-then-accept', () => {
    it('records a proposal, then rotates the admin on acceptance', async () => {
      const proposed = await service.propose(
        { actorId: 'actor-proposer', contractId: CONTRACT_ID },
        { newAdminAddress: NEW_ADMIN },
      );

      expect(proposed.adminAddress).toBeDefined();
      expect(proposed.pendingAdminAddress).toBe(NEW_ADMIN);
      // The admin is untouched until acceptance.
      expect(proposed.adminAddress).not.toBe(NEW_ADMIN);
      expect(proposed.transactionHash).toHaveLength(64);

      const accepted = await service.accept({
        actorId: 'actor-accepter',
        contractId: CONTRACT_ID,
      });

      expect(accepted.adminAddress).toBe(NEW_ADMIN);
      expect(accepted.pendingAdminAddress).toBeNull();

      const state = await service.getState(CONTRACT_ID);
      expect(state.adminAddress).toBe(NEW_ADMIN);
      expect(state.pendingAdminAddress).toBeNull();

      expect(auditService.record).toHaveBeenCalledTimes(2);

      const proposalEntry = auditService.record.mock.calls[0][0];
      expect(proposalEntry).toMatchObject({
        actorId: 'actor-proposer',
        entity: 'AdminTransfer',
        entityId: CONTRACT_ID,
        action: ADMIN_TRANSFER_AUDIT_ACTIONS.proposed,
      });
      expect(proposalEntry.metadata).toMatchObject({
        pendingAdminAddress: NEW_ADMIN,
        previousAdminAddress: proposed.adminAddress,
        transactionHash: proposed.transactionHash,
      });

      const acceptanceEntry = auditService.record.mock.calls[1][0];
      expect(acceptanceEntry).toMatchObject({
        actorId: 'actor-accepter',
        entity: 'AdminTransfer',
        entityId: CONTRACT_ID,
        action: ADMIN_TRANSFER_AUDIT_ACTIONS.accepted,
      });
      expect(acceptanceEntry.metadata).toMatchObject({
        newAdminAddress: NEW_ADMIN,
        transactionHash: accepted.transactionHash,
      });
    });
  });

  describe('propose-then-cancel', () => {
    it('records both legs and leaves the original admin in place', async () => {
      const initial = await service.getState(CONTRACT_ID);

      const proposed = await service.propose(
        { actorId: 'actor-proposer', contractId: CONTRACT_ID },
        { newAdminAddress: NEW_ADMIN },
      );
      expect(proposed.pendingAdminAddress).toBe(NEW_ADMIN);

      const cancelled = await service.cancel({
        actorId: 'actor-canceller',
        contractId: CONTRACT_ID,
      });

      expect(cancelled.adminAddress).toBe(initial.adminAddress);
      expect(cancelled.pendingAdminAddress).toBeNull();

      const state = await service.getState(CONTRACT_ID);
      expect(state.adminAddress).toBe(initial.adminAddress);
      expect(state.pendingAdminAddress).toBeNull();

      expect(auditService.record).toHaveBeenCalledTimes(2);

      const cancellationEntry = auditService.record.mock.calls[1][0];
      expect(cancellationEntry).toMatchObject({
        actorId: 'actor-canceller',
        entity: 'AdminTransfer',
        entityId: CONTRACT_ID,
        action: ADMIN_TRANSFER_AUDIT_ACTIONS.cancelled,
      });
      expect(cancellationEntry.metadata).toMatchObject({
        cancelledPendingAdminAddress: NEW_ADMIN,
        remainingAdminAddress: initial.adminAddress,
      });
    });
  });

  describe('guards', () => {
    it('rejects acceptance when no transfer is pending', async () => {
      await expect(
        service.accept({ actorId: 'actor', contractId: CONTRACT_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('rejects cancellation when no transfer is pending', async () => {
      await expect(
        service.cancel({ actorId: 'actor', contractId: CONTRACT_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('rejects proposing the address that is already admin', async () => {
      const state = await service.getState(CONTRACT_ID);

      await expect(
        service.propose(
          { actorId: 'actor', contractId: CONTRACT_ID },
          { newAdminAddress: state.adminAddress },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('does not audit a proposal the contract failed to record', async () => {
      // Simulate the contract silently ignoring the nomination.
      const misleading = {
        ...adapter,
        transferAdmin: jest.fn().mockResolvedValue({
          contractId: CONTRACT_ID,
          transactionHash: 'HASH',
          adminAddress: CURRENT_ADMIN,
          pendingAdminAddress: null,
          timestamp: new Date(),
        } satisfies AdminTransferResult),
        getAdminState: jest.fn().mockResolvedValue({
          adminAddress: CURRENT_ADMIN,
          pendingAdminAddress: null,
          timestamp: new Date(),
        }),
      } as unknown as OnchainAdapter;

      const guarded = new AdminTransferService(
        misleading,
        auditService as never,
      );

      await expect(
        guarded.propose(
          { actorId: 'actor', contractId: CONTRACT_ID },
          { newAdminAddress: NEW_ADMIN },
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(auditService.record).not.toHaveBeenCalled();
    });
  });
});
