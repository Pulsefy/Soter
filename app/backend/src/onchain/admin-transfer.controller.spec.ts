import { AppRole } from '../auth/app-role.enum';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AdminTransferController } from './admin-transfer.controller';
import { AdminTransferService } from './admin-transfer.service';

describe('AdminTransferController', () => {
  let controller: AdminTransferController;
  let service: {
    initiateTransfer: jest.Mock;
    acceptTransfer: jest.Mock;
    cancelTransfer: jest.Mock;
    getPendingAdmin: jest.Mock;
  };

  const NEW_ADMIN =
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  beforeEach(() => {
    service = {
      initiateTransfer: jest.fn(),
      acceptTransfer: jest.fn(),
      cancelTransfer: jest.fn(),
      getPendingAdmin: jest.fn(),
    };
    controller = new AdminTransferController(
      service as unknown as AdminTransferService,
    );
  });

  it('restricts every route to the admin role', () => {
    const handlers = [
      controller.initiateTransfer,
      controller.acceptTransfer,
      controller.cancelTransfer,
      controller.getPendingAdmin,
    ];

    for (const handler of handlers) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([AppRole.admin]);
    }
  });

  it('forwards the JWT actor id and the proposed address when initiating', async () => {
    service.initiateTransfer.mockResolvedValue({ newAdmin: NEW_ADMIN });

    await controller.initiateTransfer(
      { newAdmin: NEW_ADMIN },
      { user: { id: 'actor-1' } } as never,
    );

    expect(service.initiateTransfer).toHaveBeenCalledWith({
      newAdmin: NEW_ADMIN,
      actorId: 'actor-1',
    });
  });

  it('defaults a missing newAdmin to an empty string so the service validates it', async () => {
    service.initiateTransfer.mockResolvedValue({ newAdmin: '' });

    await controller.initiateTransfer({}, { user: { id: 'actor-1' } } as never);

    expect(service.initiateTransfer).toHaveBeenCalledWith({
      newAdmin: '',
      actorId: 'actor-1',
    });
  });

  it('uses the API key id as the actor when there is no JWT subject', async () => {
    service.acceptTransfer.mockResolvedValue({ admin: NEW_ADMIN });

    await controller.acceptTransfer({
      user: { apiKeyId: 'key-9' },
    } as never);

    expect(service.acceptTransfer).toHaveBeenCalledWith('key-9');
  });

  it('falls back to the apiKeyId for cancel and delegates the pending read', async () => {
    service.cancelTransfer.mockResolvedValue({ cancelledAdmin: NEW_ADMIN });
    service.getPendingAdmin.mockResolvedValue({
      pendingAdmin: NEW_ADMIN,
      timestamp: new Date(),
    });

    await controller.cancelTransfer({ user: { apiKeyId: 'key-9' } } as never);
    const pending = await controller.getPendingAdmin();

    expect(service.cancelTransfer).toHaveBeenCalledWith('key-9');
    expect(pending.pendingAdmin).toBe(NEW_ADMIN);
  });
});
