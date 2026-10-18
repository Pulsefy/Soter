import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { SurplusWithdrawalController } from './surplus-withdrawal.controller';
import { SurplusWithdrawalService } from './surplus-withdrawal.service';
import { AppRole } from '../auth/app-role.enum';
import { ROLES_KEY } from '../auth/roles.decorator';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

const mockService = {
  getStatus: jest.fn(),
  propose: jest.fn(),
  cancel: jest.fn(),
  execute: jest.fn(),
};

const jwtRequest = { user: { sub: 'admin_1' } };
const apiKeyRequest = { user: { apiKeyId: 'key_1' } };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SurplusWithdrawalController', () => {
  let controller: SurplusWithdrawalController;
  let reflector: Reflector;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SurplusWithdrawalController],
      providers: [{ provide: SurplusWithdrawalService, useValue: mockService }],
    }).compile();

    controller = module.get<SurplusWithdrawalController>(
      SurplusWithdrawalController,
    );
    reflector = module.get<Reflector>(Reflector);
  });

  // ── authorization ─────────────────────────────────────────────────────────

  describe('authorization', () => {
    const handlers = ['getStatus', 'propose', 'cancel', 'execute'] as const;

    it.each(handlers)('%s requires the admin role', handler => {
      const roles = reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
        SurplusWithdrawalController.prototype[handler],
      ]);

      expect(roles).toEqual([AppRole.admin]);
    });
  });

  // ── status ────────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns the service status', async () => {
      mockService.getStatus.mockResolvedValue({ pendingWithdrawal: null });

      await expect(controller.getStatus()).resolves.toEqual({
        pendingWithdrawal: null,
      });
    });
  });

  // ── actor attribution ─────────────────────────────────────────────────────

  describe('actor attribution', () => {
    const dto = { to: 'GTO', amount: '1000', token: 'USDC' };

    it('records the JWT subject on propose', async () => {
      mockService.propose.mockResolvedValue({});

      await controller.propose(dto, jwtRequest);

      expect(mockService.propose).toHaveBeenCalledWith(
        { actorId: 'admin_1' },
        dto,
      );
    });

    it('falls back to the API key id so key callers stay attributable', async () => {
      mockService.cancel.mockResolvedValue({});
      mockService.execute.mockResolvedValue({});

      await controller.cancel(apiKeyRequest);
      await controller.execute(apiKeyRequest);

      expect(mockService.cancel).toHaveBeenCalledWith({ actorId: 'key_1' });
      expect(mockService.execute).toHaveBeenCalledWith({ actorId: 'key_1' });
    });

    it('does not leave the actor blank for an unauthenticated request', async () => {
      mockService.propose.mockResolvedValue({});

      await controller.propose(dto, {});

      expect(mockService.propose).toHaveBeenCalledWith(
        { actorId: 'unknown' },
        dto,
      );
    });
  });
});
