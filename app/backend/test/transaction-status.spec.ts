import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { AidEscrowService } from '../src/onchain/aid-escrow.service';
import { AidEscrowController } from '../src/onchain/aid-escrow.controller';
import { MockOnchainAdapter } from '../src/onchain/onchain.adapter.mock';
import { ONCHAIN_ADAPTER_TOKEN } from '../src/onchain/onchain.adapter';
import { BudgetService } from '../src/common/budget/budget.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Transaction Status Polling', () => {
  let service: AidEscrowService;
  let controller: AidEscrowController;
  let mockAdapter: MockOnchainAdapter;

  beforeEach(async () => {
    mockAdapter = new MockOnchainAdapter();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AidEscrowController],
      providers: [
        AidEscrowService,
        BudgetService,
        { provide: PrismaService, useValue: {} },
        { provide: ONCHAIN_ADAPTER_TOKEN, useValue: mockAdapter },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('testnet') },
        },
      ],
    }).compile();

    service = module.get<AidEscrowService>(AidEscrowService);
    controller = module.get<AidEscrowController>(AidEscrowController);
  });

  // ── Status mapping ────────────────────────────────────────────────────────

  describe('MockOnchainAdapter: status mapping', () => {
    it('returns "succeeded" for hash starting with 0-7', async () => {
      const result = await mockAdapter.getTransactionStatus({
        hash: '0ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.status).toBe('succeeded');
    });

    it('returns "pending" for hash starting with 8-B', async () => {
      const result = await mockAdapter.getTransactionStatus({
        hash: '9ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.status).toBe('pending');
    });

    it('returns "failed" for hash starting with C-D', async () => {
      const result = await mockAdapter.getTransactionStatus({
        hash: 'CABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.status).toBe('failed');
    });

    it('returns "unknown" for hash starting with E-F', async () => {
      const result = await mockAdapter.getTransactionStatus({
        hash: 'EABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.status).toBe('unknown');
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe('MockOnchainAdapter: response shape', () => {
    it('normalises hash to uppercase', async () => {
      const result = await mockAdapter.getTransactionStatus({
        hash: '1abc123def456abc123def456abc123def456abc123def456abc123def456ab',
      });
      expect(result.hash).toBe(
        '1ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      );
    });

    it('includes ledger for succeeded status', async () => {
      const result = await mockAdapter.getTransactionStatus({
        hash: '1ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.status).toBe('succeeded');
      expect(result.ledger).toBe(12345);
    });

    it('includes errorMessage for failed status', async () => {
      const result = await mockAdapter.getTransactionStatus({
        hash: 'CABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBeTruthy();
    });

    it('does not include errorMessage for succeeded status', async () => {
      const result = await mockAdapter.getTransactionStatus({
        hash: '1ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.errorMessage).toBeUndefined();
    });

    it('returns a Date timestamp', async () => {
      const result = await mockAdapter.getTransactionStatus({
        hash: '1ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  // ── Service layer ─────────────────────────────────────────────────────────

  describe('AidEscrowService.getTransactionStatus', () => {
    it('delegates to adapter and returns result', async () => {
      const result = await service.getTransactionStatus(
        '1ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      );
      expect(result).toBeDefined();
      expect(result.hash).toBe(
        '1ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      );
      expect(['pending', 'succeeded', 'failed', 'unknown']).toContain(
        result.status,
      );
    });
  });

  // ── Controller layer ──────────────────────────────────────────────────────

  describe('AidEscrowController.getTransactionStatus', () => {
    it('returns status for a valid hash', async () => {
      const result = await controller.getTransactionStatus(
        '1ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      );
      expect(result).toBeDefined();
      expect(result.status).toBeDefined();
      expect(['pending', 'succeeded', 'failed', 'unknown']).toContain(
        result.status,
      );
    });

    it('throws BadRequestException for empty hash', async () => {
      await expect(controller.getTransactionStatus('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for hash that is too short', async () => {
      await expect(controller.getTransactionStatus('ABC')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns succeeded status with ledger for 0-7 prefix hash', async () => {
      const result = await controller.getTransactionStatus(
        '3ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      );
      expect(result.status).toBe('succeeded');
      expect(result.ledger).toBeDefined();
    });

    it('returns pending status for 8-B prefix hash', async () => {
      const result = await controller.getTransactionStatus(
        'AABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      );
      expect(result.status).toBe('pending');
    });

    it('returns failed status with errorMessage for C-D prefix hash', async () => {
      const result = await controller.getTransactionStatus(
        'DABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      );
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBeTruthy();
    });

    it('returns unknown status for E-F prefix hash', async () => {
      const result = await controller.getTransactionStatus(
        'FABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      );
      expect(result.status).toBe('unknown');
    });
  });

  // ── Timeout behaviour ─────────────────────────────────────────────────────

  describe('Timeout behaviour', () => {
    it('returns unknown status when adapter times out', async () => {
      jest.spyOn(mockAdapter, 'getTransactionStatus').mockResolvedValueOnce({
        hash: 'TIMEOUT_HASH',
        status: 'unknown',
        timestamp: new Date(),
      });

      const result = await service.getTransactionStatus('TIMEOUT_HASH');
      expect(result.status).toBe('unknown');
    });
  });
});
