import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConflictException } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { CancelAndReissueService } from './cancel-and-reissue.service';
import { InternalNotesService } from 'src/common/services/internal-notes.service';
import { SorobanEventCorrelationService } from '../onchain/soroban-event-correlation.service';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import type { ReverifyClaimDto } from './dto/reverify-claim.dto';

function makeMockResponse() {
  const stream = new PassThrough();
  return Object.assign(stream, {
    setHeader: jest.fn(),
    headersSent: false,
  }) as unknown as Response & PassThrough;
}

describe('ClaimsController', () => {
  let controller: ClaimsController;
  let claimsService: {
    countExport: jest.Mock;
    streamExportCsv: jest.Mock;
    reverifyClaim: jest.Mock;
  };

  beforeEach(async () => {
    claimsService = {
      countExport: jest.fn(),
      streamExportCsv: jest.fn(),
      reverifyClaim: jest.fn(),
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

  describe('exportClaims', () => {
    async function* fakeCsv() {
      await Promise.resolve();
      yield 'id,campaignId\r\n';
      yield '"claim-1","campaign-1"\r\n';
      yield '"claim-2","campaign-1"\r\n';
    }

    it('streams the CSV body as separate chunks instead of buffering it whole', async () => {
      claimsService.countExport.mockResolved(2);
      claimsService.streamExportCsv.mockReturnValue(fakeCsv());

      const res = makeMockResponse();
      const chunks: string[] = [];
      res.on('data', chunk => chunks.push(chunk.toString()));

      await controller.exportClaims([], res);

      // Proof of streaming, not buffering: the response body arrived as
      // multiple discrete writes (one per generator yield), not a single
      // write of the fully-assembled string.
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(
        'id,campaignId\r\n"claim-1","campaign-1"\r\n"claim-2","campaign-1"\r\n',
      );
    });

    it('sets CSV response headers, including total count', async () => {
      claimsService.countExport.mockResolved(2);
      claimsService.streamExportCsv.mockReturnValue(fakeCsv());

      const res = makeMockResponse();
      res.resume(); // drain so the pipeline completes without a reader attached

      await controller.exportClaims([], res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv; charset=utf-8',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment; filename="claims-export-'),
      );
      expect(res.setHeader).toHaveBeenCalledWith('X-Total-Count', '2');
    });

    it('requires the operator or admin role', () => {
      const reflector = new Reflector();
      const roles = reflector.get(
        ROLES_KEY,
        ClaimsController.prototype.exportClaims,
      );

      expect(roles).toEqual([AppRole.operator, AppRole.admin]);
    });
  });

  describe('reverifyClaim', () => {
    const baseDto: ReverifyClaimDto = {
      reason: 'Prompt fix deployed; re-running verification.',
      actor: 'operator@example.com',
    };

    it('requires the admin role', () => {
      const reflector = new Reflector();
      const roles = reflector.get(
        ROLES_KEY,
        ClaimsController.prototype.reverifyClaim,
      );

      expect(roles).toEqual([AppRole.admin]);
    });

    it('re-enqueues verification for a claim and returns the result', async () => {
      const result = {
        claimId: 'claim-1',
        status: 'pending',
        requeued: true,
      };
      claimsService.reverifyClaim.mockResolved(result);

      const response = await controller.reverifyClaim(
        'claim-1',
        baseDto,
        'user-123',
      );

      expect(claimsService.reverifyClaim).toHaveBeenCalledWith(
        'claim-1',
        baseDto,
        'user-123',
      );
      expect(response).toEqual(result);
    });

    it('rejects re-verification of a terminal-state claim without override', async () => {
      claimsService.reverifyClaim.mockRejected(
        new ConflictException(
          'Claim claim-1 is in terminal state disbursed; set overrideTerminal to re-verify.',
        ),
      );

      await expect(
        controller.reverifyClaim('claim-1', baseDto, 'user-123'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('passes the override flag through to the service', async () => {
      const dtoWithOverride: ReverifyClaimDto = {
        ...baseDto,
        overrideTerminal: true,
      };
      const result = {
        claimId: 'claim-1',
        status: 'pending',
        requeued: true,
      };
      claimsService.reverifyClaim.mockResolved(result);

      await controller.reverifyClaim('claim-1', dtoWithOverride, 'user-123');

      expect(claimsService.reverifyClaim).toHaveBeenCalledWith(
        'claim-1',
        dtoWithOverride,
        'user-123',
      );
    });
  });
})
