import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { AidEscrowController } from './aid-escrow.controller';
import { AidEscrowService } from './aid-escrow.service';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { SorobanEventCorrelationService } from './soroban-event-correlation.service';

describe('AidEscrowController - batch operations', () => {
  let controller: AidEscrowController;
  let service: {
    batchRevoke: jest.Mock;
    batchRefund: jest.Mock;
  };
  let correlationService: Record<string, any>;

  beforeEach(() => {
    service = {
      batchRevoke: jest.fn(),
      batchRefund: jest.fn(),
    };
    correlationService = {};
    controller = new AidEscrowController(
      service as unknown as AidEscrowService,
      correlationService as unknown as SorobanEventCorrelationService,
    );
  });

  describe('role restrictions', () => {
    it('batchRevoke is restricted to admin role', () => {
      const roles = new Reflector().get(
        ROLES_KEY,
        AidEscrowController.prototype.batchRevoke,
      );
      expect(roles).toEqual([AppRole.admin]);
    });

    it('batchRefund is restricted to admin role', () => {
      const roles = new Reflector().get(
        ROLES_KEY,
        AidEscrowController.prototype.batchRefund,
      );
      expect(roles).toEqual([AppRole.admin]);
    });
  });

  describe('batchRevoke endpoint', () => {
    it('returns per-id BatchAdminActionResult for a fully-successful batch', async () => {
      const mockResult = {
        results: [
          { packageId: 'pkg-1', status: 'Success', amount: '1000' },
          { packageId: 'pkg-2', status: 'Success', amount: '2000' },
        ],
        transactionHash: 'MOCK_TX_HASH_SUCCESS',
        timestamp: new Date(),
        status: 'success',
      };
      service.batchRevoke.mockResolvedValue(mockResult);

      const response = await controller.batchRevoke(
        { ids: ['pkg-1', 'pkg-2'] },
        { user: { address: 'admin-address' } } as any,
      );

      expect(service.batchRevoke).toHaveBeenCalledWith(
        { ids: ['pkg-1', 'pkg-2'] },
        'admin-address',
      );
      expect(response).toEqual(mockResult);
      expect(response.results).toHaveLength(2);
      expect(response.results[0].status).toBe('Success');
      expect(response.results[1].status).toBe('Success');
    });

    it('returns per-id BatchAdminActionResult for a batch with rejected IDs', async () => {
      const mockResult = {
        results: [
          { packageId: 'pkg-valid', status: 'Success', amount: '1000' },
          { packageId: 'pkg-claimed', status: 'InvalidState', amount: '0' },
          { packageId: 'pkg-unknown', status: 'NotFound', amount: '0' },
        ],
        transactionHash: 'MOCK_TX_HASH_PARTIAL',
        timestamp: new Date(),
        status: 'success',
      };
      service.batchRevoke.mockResolvedValue(mockResult);

      const response = await controller.batchRevoke(
        { ids: ['pkg-valid', 'pkg-claimed', 'pkg-unknown'] },
        { user: { address: 'admin-address' } } as any,
      );

      expect(response.results).toEqual([
        { packageId: 'pkg-valid', status: 'Success', amount: '1000' },
        { packageId: 'pkg-claimed', status: 'InvalidState', amount: '0' },
        { packageId: 'pkg-unknown', status: 'NotFound', amount: '0' },
      ]);
    });
  });

  describe('batchRefund endpoint', () => {
    it('returns per-id BatchAdminActionResult for a fully-successful batch', async () => {
      const mockResult = {
        results: [
          { packageId: 'pkg-expired', status: 'Success', amount: '1000' },
          { packageId: 'pkg-cancelled', status: 'Success', amount: '2000' },
        ],
        transactionHash: 'MOCK_TX_HASH_REFUND_SUCCESS',
        timestamp: new Date(),
        status: 'success',
      };
      service.batchRefund.mockResolvedValue(mockResult);

      const response = await controller.batchRefund(
        { ids: ['pkg-expired', 'pkg-cancelled'] },
        { user: { address: 'admin-address' } } as any,
      );

      expect(service.batchRefund).toHaveBeenCalledWith(
        { ids: ['pkg-expired', 'pkg-cancelled'] },
        'admin-address',
      );
      expect(response).toEqual(mockResult);
      expect(response.results.every((r: any) => r.status === 'Success')).toBe(true);
    });

    it('returns per-id BatchAdminActionResult for a batch with rejected IDs', async () => {
      const mockResult = {
        results: [
          { packageId: 'pkg-expired', status: 'Success', amount: '1000' },
          { packageId: 'pkg-live', status: 'NotExpired', amount: '0' },
          { packageId: 'pkg-unknown', status: 'NotFound', amount: '0' },
        ],
        transactionHash: 'MOCK_TX_HASH_REFUND_PARTIAL',
        timestamp: new Date(),
        status: 'success',
      };
      service.batchRefund.mockResolvedValue(mockResult);

      const response = await controller.batchRefund(
        { ids: ['pkg-expired', 'pkg-live', 'pkg-unknown'] },
        { user: { address: 'admin-address' } } as any,
      );

      expect(response.results).toEqual([
        { packageId: 'pkg-expired', status: 'Success', amount: '1000' },
        { packageId: 'pkg-live', status: 'NotExpired', amount: '0' },
        { packageId: 'pkg-unknown', status: 'NotFound', amount: '0' },
      ]);
    });
  });
});