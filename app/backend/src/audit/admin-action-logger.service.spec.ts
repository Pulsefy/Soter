import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AdminActionLogger,
  getAdminActionActor,
  getAdminActionCorrelationId,
} from './admin-action-logger.service';
import { AuditService } from './audit.service';
import { AppException } from '../common/constants/integration-error-codes';

describe('AdminActionLogger', () => {
  let logger: AdminActionLogger;
  let auditService: { record: jest.Mock };

  beforeEach(() => {
    auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    logger = new AdminActionLogger(auditService as unknown as AuditService);
  });

  it('resolves the authenticated actor and preserves middleware correlation IDs', () => {
    const request = {
      user: { sub: 'subject-1', id: 'user-1', apiKeyId: 'key-1' },
      correlationId: 'middleware-id',
      headers: { 'x-correlation-id': 'header-id' },
    };

    expect(getAdminActionActor(request)).toBe('subject-1');
    expect(getAdminActionCorrelationId(request)).toBe('middleware-id');
    expect(
      getAdminActionCorrelationId({
        headers: { 'x-request-id': 'request-id' },
      }),
    ).toBe('request-id');
  });

  it('records success using the audit schema and preserves state and correlation', async () => {
    await logger.record({
      actor: 'admin-1',
      action: 'delegate.set',
      target: { type: 'aid_package', id: 'package-7' },
      before: { delegateAddress: null },
      after: { delegateAddress: 'GDELEGATE' },
      correlationId: 'corr-123',
      outcome: 'success',
    });

    expect(auditService.record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      entity: 'aid_package',
      entityId: 'package-7',
      action: 'delegate.set',
      metadata: {
        target: { type: 'aid_package', id: 'package-7' },
        before: { delegateAddress: null },
        after: { delegateAddress: 'GDELEGATE' },
        correlationId: 'corr-123',
        outcome: 'success',
        severity: 'info',
        error: null,
      },
    });
  });

  it('represents unavailable state and filters sensitive snapshot fields', async () => {
    await logger.record({
      actor: 'admin-1',
      action: 'ledger.backfill.start',
      target: null,
      before: {
        startLedger: 10,
        accessToken: 'must-not-be-logged',
        token: 'also-secret',
        tokenAddress: 'public-contract-address',
        nested: { privateKey: 'also-secret' },
      },
      after: null,
      correlationId: null,
      outcome: 'success',
    });

    expect(auditService.record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      entity: 'admin_action',
      entityId: 'unavailable',
      action: 'ledger.backfill.start',
      metadata: {
        target: null,
        before: {
          startLedger: 10,
          tokenAddress: 'public-contract-address',
          nested: {},
        },
        after: null,
        correlationId: null,
        outcome: 'success',
        severity: 'info',
        error: null,
      },
    });
    expect(JSON.stringify(auditService.record.mock.calls[0])).not.toContain(
      'must-not-be-logged',
    );
    expect(JSON.stringify(auditService.record.mock.calls[0])).not.toContain(
      'also-secret',
    );
  });

  it.each([
    [new BadRequestException(), 'rejected', 'HTTP_400', 'warn'],
    [
      new AppException('ONCHAIN_INVALID_STATE', 400, 'unsafe message'),
      'rejected',
      'ONCHAIN_INVALID_STATE',
      'warn',
    ],
    [new InternalServerErrorException(), 'failed', 'HTTP_500', 'error'],
    [new Error('private details'), 'failed', 'UNEXPECTED_ERROR', 'error'],
  ] as const)(
    'classifies %s without retaining its message',
    async (exception, outcome, code, severity) => {
      expect(logger.classifyFailure(exception)).toEqual({
        outcome,
        error: { code },
      });
      expect(JSON.stringify(logger.classifyFailure(exception))).not.toContain(
        exception.message,
      );
      await logger.record({
        actor: 'admin-1',
        action: 'pause.set',
        target: { type: 'contract', id: 'contract-1' },
        before: null,
        after: null,
        correlationId: 'corr-123',
        ...logger.classifyFailure(exception),
      });
      expect(auditService.record.mock.calls[0][0].metadata.severity).toBe(
        severity,
      );
    },
  );

  it('records failures with no resulting state', async () => {
    await expect(
      logger.execute(
        {
          actor: 'admin-1',
          action: 'delegate.set',
          target: { type: 'aid_package', id: 'package-7' },
          before: { delegateAddress: null },
          correlationId: 'corr-123',
        },
        async () => {
          throw new BadRequestException();
        },
        () => ({ delegateAddress: 'GDELEGATE' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delegate.set',
        metadata: expect.objectContaining({
          before: { delegateAddress: null },
          after: null,
          outcome: 'rejected',
          severity: 'warn',
          error: { code: 'HTTP_400' },
        }),
      }),
    );
  });

  it('does not record success for a failed transaction result', async () => {
    await logger.execute(
      {
        actor: 'admin-1',
        action: 'delegate.set',
        target: { type: 'aid_package', id: 'package-7' },
        before: null,
        correlationId: 'corr-123',
      },
      async () => ({ status: 'failed' }),
      () => ({ status: 'success' }),
      result => result.status === 'success',
    );

    expect(auditService.record.mock.calls[0][0].metadata).toMatchObject({
      outcome: 'failed',
      severity: 'error',
      after: null,
      error: { code: 'TRANSACTION_FAILED' },
    });
  });

  it('propagates audit sink failures', async () => {
    const auditFailure = new Error('audit unavailable');
    auditService.record.mockRejectedValue(auditFailure);

    await expect(
      logger.record({
        actor: 'admin-1',
        action: 'pause.set',
        target: { type: 'contract', id: 'contract-1' },
        before: null,
        after: { paused: true },
        correlationId: 'corr-123',
        outcome: 'success',
      }),
    ).rejects.toBe(auditFailure);
  });
});