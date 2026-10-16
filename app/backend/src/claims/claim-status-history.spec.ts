import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { CancelAndReissueService } from './cancel-and-reissue.service';
import { InternalNotesService } from 'src/common/services/internal-notes.service';
import { SorobanEventCorrelationService } from '../onchain/soroban-event-correlation.service';
import { AppException, ERROR_CODES } from '../common/dto/error-response.dto';
import { AppRole } from '../auth/app-role.enum';

describe('Claim Status History', () => {
  let controller: ClaimsController;
  let claimsService: {
    findOne: jest.Mock;
    getStatusHistory: jest.Mock;
  };

  beforeEach(async () => {
    claimsService = {
      findOne: jest.fn(),
      getStatusHistory: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClaimsController],
      providers: [
        { provide: ClaimsService, useValue: claimsService },
        { provide: CancelAndReissueService, useValue: {} },
        { provide: InternalNotesService, useValue: {} },
        { provide: SorobanEventCorrelationService, useValue: {} },
      ],
    }).compile();

    controller = module.get(ClaimsController);
  });

  describe('getStatusHistory', () => {
    const claimId = 'claim-123';
    const organizationId = 'org-456';

    const mockClaim = {
      id: claimId,
      campaignId: 'campaign-789',
      campaign: {
        id: 'campaign-789',
        orgId: organizationId,
        name: 'Test Campaign',
      },
      status: 'disbursed',
      amount: 100,
      createdAt: new Date('2026-01-01T10:00:00Z'),
    };

    const mockStatusHistory = {
      claimId,
      history: [
        {
          previousStatus: undefined,
          newStatus: 'requested',
          timestamp: '2026-01-01T10:00:00.000Z',
          actor: undefined,
          trigger: 'claim_creation',
          metadata: {},
        },
        {
          previousStatus: 'requested',
          newStatus: 'verified',
          timestamp: '2026-01-01T11:00:00.000Z',
          actor: 'operator-001',
          trigger: 'manual_verification',
          metadata: {
            verificationScore: 0.95,
          },
        },
        {
          previousStatus: 'verified',
          newStatus: 'approved',
          timestamp: '2026-01-01T12:00:00.000Z',
          actor: 'admin-001',
          trigger: 'manual_approval',
          metadata: {},
        },
        {
          previousStatus: 'approved',
          newStatus: 'disbursed',
          timestamp: '2026-01-01T13:00:00.000Z',
          actor: 'system',
          trigger: 'on_chain_disbursement',
          metadata: {},
        },
      ],
      historicalCoverageStart: '2026-01-01T10:00:00.000Z',
      historicalCoverageNote: undefined,
    };

    it('returns status history in chronological order', async () => {
      claimsService.findOne.mockResolvedValue(mockClaim);
      claimsService.getStatusHistory.mockResolvedValue(mockStatusHistory);

      const mockUser = { role: AppRole.admin };
      const mockRequest = { user: mockUser };

      const result = await controller.getStatusHistory(
        claimId,
        mockRequest as any,
      );

      expect(result.claimId).toBe(claimId);
      expect(result.history).toHaveLength(4);
      expect(result.history[0].newStatus).toBe('requested');
      expect(result.history[1].newStatus).toBe('verified');
      expect(result.history[2].newStatus).toBe('approved');
      expect(result.history[3].newStatus).toBe('disbursed');

      // Verify chronological ordering
      for (let i = 1; i < result.history.length; i++) {
        const prevTimestamp = new Date(result.history[i - 1].timestamp);
        const currTimestamp = new Date(result.history[i].timestamp);
        expect(currTimestamp.getTime()).toBeGreaterThanOrEqual(
          prevTimestamp.getTime(),
        );
      }
    });

    it('includes actor information when available', async () => {
      claimsService.findOne.mockResolvedValue(mockClaim);
      claimsService.getStatusHistory.mockResolvedValue(mockStatusHistory);

      const mockUser = { role: AppRole.admin };
      const mockRequest = { user: mockUser };

      const result = await controller.getStatusHistory(
        claimId,
        mockRequest as any,
      );

      const verifiedEntry = result.history[1];
      expect(verifiedEntry.actor).toBe('operator-001');

      const approvedEntry = result.history[2];
      expect(approvedEntry.actor).toBe('admin-001');

      const disburseEntry = result.history[3];
      expect(disburseEntry.actor).toBe('system');
    });

    it('includes transition trigger type', async () => {
      claimsService.findOne.mockResolvedValue(mockClaim);
      claimsService.getStatusHistory.mockResolvedValue(mockStatusHistory);

      const mockUser = { role: AppRole.admin };
      const mockRequest = { user: mockUser };

      const result = await controller.getStatusHistory(
        claimId,
        mockRequest as any,
      );

      expect(result.history[1].trigger).toBe('manual_verification');
      expect(result.history[2].trigger).toBe('manual_approval');
      expect(result.history[3].trigger).toBe('on_chain_disbursement');
    });

    it('includes metadata (verification scores, cancellation reasons, etc.)', async () => {
      claimsService.findOne.mockResolvedValue(mockClaim);
      claimsService.getStatusHistory.mockResolvedValue(mockStatusHistory);

      const mockUser = { role: AppRole.admin };
      const mockRequest = { user: mockUser };

      const result = await controller.getStatusHistory(
        claimId,
        mockRequest as any,
      );

      const verifiedEntry = result.history[1];
      expect(verifiedEntry.metadata).toBeDefined();
      expect(verifiedEntry.metadata?.verificationScore).toBe(0.95);
    });

    it('returns historical coverage start date', async () => {
      claimsService.findOne.mockResolvedValue(mockClaim);
      claimsService.getStatusHistory.mockResolvedValue(mockStatusHistory);

      const mockUser = { role: AppRole.admin };
      const mockRequest = { user: mockUser };

      const result = await controller.getStatusHistory(
        claimId,
        mockRequest as any,
      );

      expect(result.historicalCoverageStart).toBe('2026-01-01T10:00:00.000Z');
    });

    it('includes historical coverage note when tracking gap detected', async () => {
      const historyWithNote = {
        ...mockStatusHistory,
        historicalCoverageNote:
          'Incomplete history. Status history begins from the first recorded transition.',
      };

      claimsService.findOne.mockResolvedValue(mockClaim);
      claimsService.getStatusHistory.mockResolvedValue(historyWithNote);

      const mockUser = { role: AppRole.admin };
      const mockRequest = { user: mockUser };

      const result = await controller.getStatusHistory(
        claimId,
        mockRequest as any,
      );

      expect(result.historicalCoverageNote).toBeDefined();
      expect(result.historicalCoverageNote).toContain('Incomplete history');
    });

    it('enforces authorization: denies access for unauthorized organization', async () => {
      claimsService.findOne.mockResolvedValue(mockClaim);

      const mockUser = {
        role: AppRole.ngo,
        ngoId: 'different-org-999',
      };
      const mockRequest = { user: mockUser };

      await expect(
        controller.getStatusHistory(claimId, mockRequest as any),
      ).rejects.toThrow(AppException);
    });

    it('allows admin to access any organization claim', async () => {
      claimsService.findOne.mockResolvedValue(mockClaim);
      claimsService.getStatusHistory.mockResolvedValue(mockStatusHistory);

      const mockUser = { role: AppRole.admin };
      const mockRequest = { user: mockUser };

      const result = await controller.getStatusHistory(
        claimId,
        mockRequest as any,
      );

      expect(result).toBeDefined();
      expect(claimsService.getStatusHistory).toHaveBeenCalledWith(claimId);
    });

    it('allows NGO to access own organization claim', async () => {
      claimsService.findOne.mockResolvedValue(mockClaim);
      claimsService.getStatusHistory.mockResolvedValue(mockStatusHistory);

      const mockUser = {
        role: AppRole.ngo,
        ngoId: organizationId,
      };
      const mockRequest = { user: mockUser };

      const result = await controller.getStatusHistory(
        claimId,
        mockRequest as any,
      );

      expect(result).toBeDefined();
    });

    it('throws NOT_FOUND for nonexistent claim', async () => {
      claimsService.findOne.mockRejectedValue(
        new AppException(ERROR_CODES.NOT_FOUND, 404, 'Claim not found'),
      );

      const mockUser = { role: AppRole.admin };
      const mockRequest = { user: mockUser };

      await expect(
        controller.getStatusHistory(claimId, mockRequest as any),
      ).rejects.toThrow(AppException);
    });

    it('handles empty history (no recorded transitions)', async () => {
      const emptyHistory = {
        claimId,
        history: [],
        historicalCoverageStart: '2026-01-01T10:00:00.000Z',
        historicalCoverageNote:
          'No status transitions recorded. Claim may have been created before status history tracking was implemented.',
      };

      claimsService.findOne.mockResolvedValue(mockClaim);
      claimsService.getStatusHistory.mockResolvedValue(emptyHistory);

      const mockUser = { role: AppRole.admin };
      const mockRequest = { user: mockUser };

      const result = await controller.getStatusHistory(
        claimId,
        mockRequest as any,
      );

      expect(result.history).toHaveLength(0);
      expect(result.historicalCoverageNote).toBeDefined();
    });

    it('includes both previousStatus and newStatus for each transition', async () => {
      claimsService.findOne.mockResolvedValue(mockClaim);
      claimsService.getStatusHistory.mockResolvedValue(mockStatusHistory);

      const mockUser = { role: AppRole.admin };
      const mockRequest = { user: mockUser };

      const result = await controller.getStatusHistory(
        claimId,
        mockRequest as any,
      );

      // First entry might not have previousStatus (claim creation)
      const nonInitialEntry = result.history[1];
      expect(nonInitialEntry.previousStatus).toBe('requested');
      expect(nonInitialEntry.newStatus).toBe('verified');
    });

    it('respects timestamp precision and format (ISO-8601)', async () => {
      claimsService.findOne.mockResolvedValue(mockClaim);
      claimsService.getStatusHistory.mockResolvedValue(mockStatusHistory);

      const mockUser = { role: AppRole.admin };
      const mockRequest = { user: mockUser };

      const result = await controller.getStatusHistory(
        claimId,
        mockRequest as any,
      );

      result.history.forEach(entry => {
        // Verify ISO-8601 format with milliseconds
        expect(entry.timestamp).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );
      });
    });
  });
});
