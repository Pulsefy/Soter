import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { ONCHAIN_ADAPTER_TOKEN, PendingWithdrawal } from './onchain.adapter';
import {
  SURPLUS_WITHDRAWAL_AUDIT_ACTIONS,
  SurplusWithdrawalService,
} from './surplus-withdrawal.service';
import { SurplusWithdrawalTimelockNotElapsedError } from './utils/surplus-withdrawal.errors';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

const NOW = new Date('2025-01-01T12:00:00.000Z');
const HOUR = 3600;

const mockAdapter = {
  getPendingWithdrawal: jest.fn(),
  proposeSurplusWithdrawal: jest.fn(),
  cancelSurplusWithdrawal: jest.fn(),
  executeSurplusWithdrawal: jest.fn(),
};

const mockAudit = { record: jest.fn() };

const actor = { actorId: 'admin_1', contractId: 'CTEST' };

/**
 * Seconds since the epoch, read at call time.
 *
 * `timelockRemainingSeconds` compares `executableAt` against the real clock, so
 * a fixture anchored to a fixed date would read as long matured. Anchoring to
 * "now" is what makes "still locked" and "already matured" expressible.
 */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function makePending(
  overrides: Partial<PendingWithdrawal> = {},
): PendingWithdrawal {
  return {
    to: 'GRECIPIENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    amount: '1000',
    token: 'USDC',
    executableAt: nowSeconds() + HOUR,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SurplusWithdrawalService', () => {
  let service: SurplusWithdrawalService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAdapter.getPendingWithdrawal.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurplusWithdrawalService,
        { provide: ONCHAIN_ADAPTER_TOKEN, useValue: mockAdapter },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<SurplusWithdrawalService>(SurplusWithdrawalService);
  });

  // ── getStatus ─────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('reports an empty state when nothing is pending', async () => {
      const status = await service.getStatus(actor.contractId);

      expect(status.pendingWithdrawal).toBeNull();
      expect(status.timelockRemainingSeconds).toBe(0);
    });

    it('reports the remaining wait on a pending proposal', async () => {
      mockAdapter.getPendingWithdrawal.mockResolvedValue(
        makePending({ executableAt: nowSeconds() + 600 }),
      );

      const status = await service.getStatus(actor.contractId);

      expect(status.timelockRemainingSeconds).toBeGreaterThan(0);
      expect(status.timelockRemainingSeconds).toBeLessThanOrEqual(600);
    });

    it('does not mutate on-chain state', async () => {
      await service.getStatus(actor.contractId);

      expect(mockAdapter.proposeSurplusWithdrawal).not.toHaveBeenCalled();
      expect(mockAdapter.cancelSurplusWithdrawal).not.toHaveBeenCalled();
      expect(mockAdapter.executeSurplusWithdrawal).not.toHaveBeenCalled();
    });
  });

  // ── propose ───────────────────────────────────────────────────────────────

  describe('propose', () => {
    const dto = { to: 'GTO', amount: '1000', token: 'USDC' };

    it('records the proposal and audits it', async () => {
      const pending = makePending({ to: 'GTO' });
      mockAdapter.proposeSurplusWithdrawal.mockResolvedValue({
        contractId: 'CTEST',
        pendingWithdrawal: pending,
        transactionHash: 'abc',
        timestamp: NOW,
      });

      const status = await service.propose(actor, dto);

      expect(mockAdapter.proposeSurplusWithdrawal).toHaveBeenCalledWith({
        contractId: 'CTEST',
        to: 'GTO',
        amount: '1000',
        token: 'USDC',
      });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: SURPLUS_WITHDRAWAL_AUDIT_ACTIONS.proposed,
          metadata: expect.objectContaining({ amount: '1000', token: 'USDC' }),
        }),
      );
      expect(status.pendingWithdrawal).toEqual(pending);
    });

    it('refuses to stack a second proposal on a pending one', async () => {
      mockAdapter.getPendingWithdrawal.mockResolvedValue(makePending());

      await expect(service.propose(actor, dto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockAdapter.proposeSurplusWithdrawal).not.toHaveBeenCalled();
    });

    it('fails when the contract records nothing', async () => {
      mockAdapter.proposeSurplusWithdrawal.mockResolvedValue({
        contractId: 'CTEST',
        pendingWithdrawal: null,
        transactionHash: 'abc',
        timestamp: NOW,
      });

      await expect(service.propose(actor, dto)).rejects.toThrow(
        /did not record a pending/,
      );
      expect(mockAudit.record).not.toHaveBeenCalled();
    });

    it('fails when the contract recorded a different proposal', async () => {
      mockAdapter.proposeSurplusWithdrawal.mockResolvedValue({
        contractId: 'CTEST',
        pendingWithdrawal: makePending({ to: 'GOTHER', amount: '999' }),
        transactionHash: 'abc',
        timestamp: NOW,
      });

      await expect(service.propose(actor, dto)).rejects.toThrow(
        /different proposal/,
      );
      expect(mockAudit.record).not.toHaveBeenCalled();
    });
  });

  // ── cancel ────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('cancels a pending proposal and audits what was abandoned', async () => {
      const pending = makePending();
      mockAdapter.getPendingWithdrawal.mockResolvedValue(pending);
      mockAdapter.cancelSurplusWithdrawal.mockResolvedValue({
        contractId: 'CTEST',
        pendingWithdrawal: null,
        transactionHash: 'abc',
        timestamp: NOW,
      });

      const status = await service.cancel(actor);

      expect(mockAdapter.cancelSurplusWithdrawal).toHaveBeenCalledWith({
        contractId: 'CTEST',
      });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: SURPLUS_WITHDRAWAL_AUDIT_ACTIONS.cancelled,
          metadata: expect.objectContaining({ cancelledAmount: '1000' }),
        }),
      );
      expect(status.pendingWithdrawal).toBeNull();
    });

    it('rejects cancelling when nothing is pending', async () => {
      await expect(service.cancel(actor)).rejects.toThrow(BadRequestException);
      expect(mockAdapter.cancelSurplusWithdrawal).not.toHaveBeenCalled();
    });

    it('fails when the contract still reports the proposal as pending', async () => {
      mockAdapter.getPendingWithdrawal.mockResolvedValue(makePending());
      mockAdapter.cancelSurplusWithdrawal.mockResolvedValue({
        contractId: 'CTEST',
        pendingWithdrawal: makePending(),
        transactionHash: 'abc',
        timestamp: NOW,
      });

      await expect(service.cancel(actor)).rejects.toThrow(ConflictException);
      expect(mockAudit.record).not.toHaveBeenCalled();
    });
  });

  // ── execute ───────────────────────────────────────────────────────────────

  describe('execute', () => {
    it('executes once the timelock has elapsed and audits the release', async () => {
      const pending = makePending({ executableAt: nowSeconds() - 1 });
      mockAdapter.getPendingWithdrawal.mockResolvedValue(pending);
      mockAdapter.executeSurplusWithdrawal.mockResolvedValue({
        contractId: 'CTEST',
        pendingWithdrawal: null,
        transactionHash: 'abc',
        timestamp: NOW,
      });

      const status = await service.execute(actor);

      expect(mockAdapter.executeSurplusWithdrawal).toHaveBeenCalledWith({
        contractId: 'CTEST',
      });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: SURPLUS_WITHDRAWAL_AUDIT_ACTIONS.executed,
          metadata: expect.objectContaining({ executedAmount: '1000' }),
        }),
      );
      expect(status.pendingWithdrawal).toBeNull();
    });

    it('reports a distinct conflict while the timelock is still running', async () => {
      mockAdapter.getPendingWithdrawal.mockResolvedValue(
        makePending({ executableAt: nowSeconds() + 600 }),
      );

      const error = await service.execute(actor).catch(e => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        code: 'SURPLUS_WITHDRAWAL_TIMELOCK_ACTIVE',
      });
      expect(mockAdapter.executeSurplusWithdrawal).not.toHaveBeenCalled();
      expect(mockAudit.record).not.toHaveBeenCalled();
    });

    it('surfaces a contract-level timelock rejection as the same conflict', async () => {
      // The chain is the authority on the delay; a locally-elapsed proposal
      // that the contract still rejects must read the same to the caller.
      mockAdapter.getPendingWithdrawal.mockResolvedValue(
        makePending({ executableAt: nowSeconds() - 1 }),
      );
      mockAdapter.executeSurplusWithdrawal.mockRejectedValue(
        new SurplusWithdrawalTimelockNotElapsedError(),
      );

      const error = await service.execute(actor).catch(e => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        code: 'SURPLUS_WITHDRAWAL_TIMELOCK_ACTIVE',
      });
    });

    it('rejects executing when nothing is pending', async () => {
      await expect(service.execute(actor)).rejects.toThrow(BadRequestException);
      expect(mockAdapter.executeSurplusWithdrawal).not.toHaveBeenCalled();
    });

    it('fails when the contract still reports the proposal as pending', async () => {
      mockAdapter.getPendingWithdrawal.mockResolvedValue(
        makePending({ executableAt: nowSeconds() - 1 }),
      );
      mockAdapter.executeSurplusWithdrawal.mockResolvedValue({
        contractId: 'CTEST',
        pendingWithdrawal: makePending(),
        transactionHash: 'abc',
        timestamp: NOW,
      });

      await expect(service.execute(actor)).rejects.toThrow(ConflictException);
      expect(mockAudit.record).not.toHaveBeenCalled();
    });

    it('does not swallow an unrelated contract failure', async () => {
      mockAdapter.getPendingWithdrawal.mockResolvedValue(
        makePending({ executableAt: nowSeconds() - 1 }),
      );
      mockAdapter.executeSurplusWithdrawal.mockRejectedValue(
        new Error('insufficient trustline balance'),
      );

      await expect(service.execute(actor)).rejects.toThrow(
        'insufficient trustline balance',
      );
    });
  });
});
