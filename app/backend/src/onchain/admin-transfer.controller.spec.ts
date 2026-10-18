import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { AdminTransferController } from './admin-transfer.controller';
import { AdminTransferService } from './admin-transfer.service';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

const NEW_ADMIN = `G${'B'.repeat(55)}`;
const RESULT = {
  contractId: 'CDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEAD',
  transactionHash: 'HASH',
  adminAddress: `G${'A'.repeat(55)}`,
  pendingAdminAddress: NEW_ADMIN,
  timestamp: new Date(),
};

describe('AdminTransferController', () => {
  let controller: AdminTransferController;
  let service: {
    getState: jest.Mock;
    propose: jest.Mock;
    accept: jest.Mock;
    cancel: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getState: jest.fn().mockResolvedValue(RESULT),
      propose: jest.fn().mockResolvedValue(RESULT),
      accept: jest.fn().mockResolvedValue(RESULT),
      cancel: jest.fn().mockResolvedValue(RESULT),
    };
    controller = new AdminTransferController(
      service as unknown as AdminTransferService,
    );
  });

  describe('role gate', () => {
    const cases: Array<[string, keyof AdminTransferController]> = [
      ['getState', 'getState'],
      ['propose', 'propose'],
      ['accept', 'accept'],
      ['cancel', 'cancel'],
    ];

    it.each(cases)('%s is restricted to admins', (_name, method) => {
      const reflector = new Reflector();
      const roles = reflector.get(
        ROLES_KEY,
        AdminTransferController.prototype[method],
      );

      expect(roles).toEqual([AppRole.admin]);
    });
  });

  describe('propose', () => {
    it('attributes the action to the API key that initiated it', async () => {
      await controller.propose(
        { newAdminAddress: NEW_ADMIN },
        { user: { apiKeyId: 'key-123' } },
      );

      expect(service.propose).toHaveBeenCalledWith(
        { actorId: 'key-123' },
        { newAdminAddress: NEW_ADMIN },
      );
    });

    it('prefers the JWT subject over the database id', async () => {
      await controller.propose(
        { newAdminAddress: NEW_ADMIN },
        { user: { sub: 'subject-1', id: 'user-9' } },
      );

      expect(service.propose).toHaveBeenCalledWith(
        { actorId: 'subject-1' },
        { newAdminAddress: NEW_ADMIN },
      );
    });
  });

  describe('accept and cancel', () => {
    it('accepts with the authenticated actor', async () => {
      await controller.accept({ user: { apiKeyId: 'key-abc' } });

      expect(service.accept).toHaveBeenCalledWith({ actorId: 'key-abc' });
    });

    it('cancels with the authenticated actor', async () => {
      await controller.cancel({ user: { id: 'user-7' } });

      expect(service.cancel).toHaveBeenCalledWith({ actorId: 'user-7' });
    });

    it('falls back to "unknown" when no actor is present', async () => {
      await controller.accept({});

      expect(service.accept).toHaveBeenCalledWith({ actorId: 'unknown' });
    });
  });
});
