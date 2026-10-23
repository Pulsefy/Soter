import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { ActionPauseController } from './action-pause.controller';
import { ActionPauseService } from './action-pause.service';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

const RESULT = {
  action: 'claim',
  transactionHash: 'HASH',
  isPaused: true,
  globallyPaused: false,
  timestamp: new Date(),
};

describe('ActionPauseController', () => {
  let controller: ActionPauseController;
  let service: {
    getStatus: jest.Mock;
    pause: jest.Mock;
    unpause: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getStatus: jest.fn().mockResolvedValue({}),
      pause: jest.fn().mockResolvedValue(RESULT),
      unpause: jest.fn().mockResolvedValue(RESULT),
    };
    controller = new ActionPauseController(
      service as unknown as ActionPauseService,
    );
  });

  it.each(['getStatus', 'pause', 'unpause'] as const)(
    '%s is restricted to admins',
    method => {
      const roles = new Reflector().get(
        ROLES_KEY,
        ActionPauseController.prototype[method],
      );
      expect(roles).toEqual([AppRole.admin]);
    },
  );

  it('attributes a pause to the API key that initiated it', async () => {
    await controller.pause('claim', { user: { apiKeyId: 'key-1' } });
    expect(service.pause).toHaveBeenCalledWith({ actorId: 'key-1' }, 'claim');
  });

  it('prefers the JWT subject when attributing an unpause', async () => {
    await controller.unpause('refund', {
      user: { sub: 'user-1', apiKeyId: 'key-1' },
    });
    expect(service.unpause).toHaveBeenCalledWith(
      { actorId: 'user-1' },
      'refund',
    );
  });
});
