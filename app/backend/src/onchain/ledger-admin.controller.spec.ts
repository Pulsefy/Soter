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

describe('LedgerAdminController', () => {
  let controller: LedgerAdminController;
  let traceService: { getTrace: jest.Mock };

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LedgerAdminController],
      providers: [
        { provide: LedgerBackfillService, useValue: {} },
        { provide: LedgerReconciliationService, useValue: {} },
        { provide: SorobanTransactionLifecycleService, useValue: {} },
        { provide: SorobanCorrelationTraceService, useValue: traceService },
      ],
    }).compile();

    controller = module.get(LedgerAdminController);
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
