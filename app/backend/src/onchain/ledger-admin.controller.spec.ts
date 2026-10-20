import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { BadRequestException } from '@nestjs/common';
import { LedgerAdminController } from './ledger-admin.controller';
import { LedgerBackfillService } from './ledger-backfill.service';
import { LedgerReconciliationService } from './ledger-reconciliation.service';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';
import { SorobanCorrelationTraceService } from './soroban-correlation-trace.service';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { AdminActionLogger } from '../audit/admin-action-logger.service';
import { AuditService } from '../audit/audit.service';

describe('LedgerAdminController', () => {
  let controller: LedgerAdminController;
  let traceService: { getTrace: jest.Mock };
  let auditService: { record: jest.Mock };
  let backfillService: {
    triggerBackfill: jest.Mock;
    getCheckpoint: jest.Mock;
    cancelBackfill: jest.Mock;
  };
  let reconciliationService: {
    triggerReconciliation: jest.Mock;
    reconcileBalances: jest.Mock;
  };

  const trace = {
    correlationId: 'corr-123',
    found: true,
    claimIds: ['claim-1'],
    txHashes: ['hash-1'],
    transactions: [],
    events: [],
    summary: {
      transactionCount: 1,
      confirmedTransactionCount: 1,
      failedTransactionCount: 0,
      pendingTransactionCount: 0,
      eventCount: 0,
      startedAt: null,
      lastActivityAt: null,
      durationMs: null,
    },
  };

  beforeEach(async () => {
    traceService = { getTrace: jest.fn().mockResolvedValue(trace) };
    auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    backfillService = {
      triggerBackfill: jest.fn().mockResolvedValue({
        jobId: 'job-1',
        checkpointId: 'checkpoint-1',
        status: 'queued',
        startLedger: 10,
        endLedger: 20,
      }),
      getCheckpoint: jest.fn().mockResolvedValue({
        status: 'running',
        lastProcessedLedger: 10,
      }),
      cancelBackfill: jest.fn().mockResolvedValue(undefined),
    };
    reconciliationService = {
      triggerReconciliation: jest.fn().mockResolvedValue({
        jobId: 'reconcile-1',
        status: 'queued',
      }),
      reconcileBalances: jest.fn().mockResolvedValue({
        runId: 'run-1',
        dryRun: false,
        discrepancies: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LedgerAdminController],
      providers: [
        { provide: LedgerBackfillService, useValue: backfillService },
        {
          provide: LedgerReconciliationService,
          useValue: reconciliationService,
        },
        { provide: SorobanTransactionLifecycleService, useValue: {} },
        { provide: SorobanCorrelationTraceService, useValue: traceService },
        { provide: AuditService, useValue: auditService },
        {
          provide: AdminActionLogger,
          useFactory: (audit: AuditService) => new AdminActionLogger(audit),
          inject: [AuditService],
        },
      ],
    }).compile();

    controller = module.get(LedgerAdminController);
  });

  describe('administrative operations', () => {
    it.each([
      'triggerBackfill',
      'cancelBackfill',
      'triggerReconciliation',
      'triggerBalanceReconciliation',
    ] as const)('%s remains restricted to admins', method => {
      const roles = new Reflector().get(
        ROLES_KEY,
        LedgerAdminController.prototype[method],
      );

      expect(roles).toEqual([AppRole.admin]);
    });

    it('records a queued backfill with the authenticated actor and correlation ID', async () => {
      const result = await controller.triggerBackfill(
        { startLedger: 10, endLedger: 20 },
        { user: { sub: 'admin-7' }, correlationId: 'corr-1380' },
      );

      expect(result).toMatchObject({ jobId: 'job-1', status: 'queued' });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-7',
          entity: 'ledger_range',
          entityId: '10-20',
          action: 'ledger.backfill.start',
          metadata: expect.objectContaining({
            correlationId: 'corr-1380',
            outcome: 'success',
            severity: 'info',
            after: {
              jobId: 'job-1',
              checkpointId: 'checkpoint-1',
              status: 'queued',
            },
          }),
        }),
      );
    });

    it('does not audit a failed backfill request as successful', async () => {
      backfillService.triggerBackfill.mockRejectedValue(
        new Error('queue down'),
      );

      await expect(
        controller.triggerBackfill(
          { startLedger: 10, endLedger: 20 },
          { user: { id: 'admin-8' }, requestId: 'request-2' },
        ),
      ).rejects.toThrow('queue down');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-8',
          action: 'ledger.backfill.start',
          metadata: expect.objectContaining({
            correlationId: 'request-2',
            outcome: 'failed',
            severity: 'error',
            error: { code: 'UNEXPECTED_ERROR' },
            after: null,
          }),
        }),
      );
    });
  });

  describe('getSorobanCorrelationTrace', () => {
    it('returns the resolved trace wrapped in the success envelope', async () => {
      const result = await controller.getSorobanCorrelationTrace('corr-123');

      expect(traceService.getTrace).toHaveBeenCalledWith('corr-123');
      expect(result).toEqual({ success: true, data: trace });
    });

    it('trims surrounding whitespace before looking the trace up', async () => {
      await controller.getSorobanCorrelationTrace('  corr-123  ');

      expect(traceService.getTrace).toHaveBeenCalledWith('corr-123');
    });

    it('rejects a blank correlation ID without querying', async () => {
      await expect(
        controller.getSorobanCorrelationTrace('   '),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(traceService.getTrace).not.toHaveBeenCalled();
    });

    it('rejects a correlation ID longer than 128 characters', async () => {
      await expect(
        controller.getSorobanCorrelationTrace('c'.repeat(129)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(traceService.getTrace).not.toHaveBeenCalled();
    });

    it('accepts a correlation ID of exactly 128 characters', async () => {
      const maxLengthId = 'c'.repeat(128);

      await controller.getSorobanCorrelationTrace(maxLengthId);

      expect(traceService.getTrace).toHaveBeenCalledWith(maxLengthId);
    });

    it('is restricted to admins', () => {
      const reflector = new Reflector();
      const roles = reflector.get(
        ROLES_KEY,
        LedgerAdminController.prototype.getSorobanCorrelationTrace,
      );

      expect(roles).toEqual([AppRole.admin]);
    });
  });
});
