import { AdminActionLogger } from '../audit/admin-action-logger.service';
import { AidEscrowService } from './aid-escrow.service';

describe('AidEscrowService admin actions', () => {
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const adapter = {
    getDelegate: jest.fn(),
    setDelegate: jest.fn(),
    revokeDelegate: jest.fn(),
  };
  let service: AidEscrowService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AidEscrowService(
      adapter as never,
      {} as never,
      { get: jest.fn().mockReturnValue('testnet') } as never,
      new AdminActionLogger(auditService as never),
    );
  });

  it('audits a confirmed delegate change with the before/after state', async () => {
    adapter.getDelegate
      .mockResolvedValueOnce({
        packageId: 'package-1',
        delegateAddress: 'GOLD',
        expiresAt: 100,
        timestamp: new Date(),
      })
      .mockResolvedValueOnce({
        packageId: 'package-1',
        delegateAddress: 'GNEW',
        expiresAt: 200,
        timestamp: new Date(),
      });
    adapter.setDelegate.mockResolvedValue({
      packageId: 'package-1',
      delegateAddress: 'GNEW',
      expiresAt: 200,
      transactionHash: 'hash-1',
      timestamp: new Date(),
      status: 'success',
    });

    await service.setDelegate(
      'package-1',
      { delegateAddress: 'GNEW', expiresAt: 200 } as never,
      'onchain-signer',
      'admin-1',
      'corr-1',
    );

    expect(adapter.setDelegate).toHaveBeenCalledWith({
      adminAddress: 'onchain-signer',
      packageId: 'package-1',
      delegateAddress: 'GNEW',
      expiresAt: 200,
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        entity: 'aid_package',
        entityId: 'package-1',
        action: 'set_delegate',
        metadata: expect.objectContaining({
          before: { delegateAddress: 'GOLD', expiresAt: 100 },
          after: { delegateAddress: 'GNEW', expiresAt: 200 },
          correlationId: 'corr-1',
          details: { transactionHash: 'hash-1' },
          outcome: 'success',
          severity: 'info',
        }),
      }),
    );
  });

  it('does not record success or a resulting delegate for failed transactions', async () => {
    adapter.getDelegate
      .mockResolvedValueOnce({
        packageId: 'package-1',
        delegateAddress: 'GOLD',
        timestamp: new Date(),
      })
      .mockResolvedValueOnce({
        packageId: 'package-1',
        timestamp: new Date(),
      });
    adapter.revokeDelegate.mockResolvedValue({
      packageId: 'package-1',
      transactionHash: 'hash-2',
      timestamp: new Date(),
      status: 'failed',
    });

    await service.revokeDelegate(
      'package-1',
      'onchain-signer',
      'admin-2',
      'corr-2',
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-2',
        action: 'revoke_delegate',
        metadata: expect.objectContaining({
          before: { delegateAddress: 'GOLD', expiresAt: null },
          after: null,
          correlationId: 'corr-2',
          outcome: 'failed',
          severity: 'error',
          error: { code: 'TRANSACTION_FAILED' },
        }),
      }),
    );
  });
});