import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CancelAndReissueService } from '../claims/cancel-and-reissue.service';
import { BudgetService } from '../common/budget/budget.service';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

function makeMockResponse() {
  const stream = new PassThrough();
  return Object.assign(stream, {
    setHeader: jest.fn(),
    headersSent: false,
  }) as unknown as Response & PassThrough;
}

describe('CampaignsController', () => {
  let controller: CampaignsController;
  let campaignsService: {
    countExport: jest.Mock;
    streamExportCsv: jest.Mock;
  };

  beforeEach(async () => {
    campaignsService = {
      countExport: jest.fn(),
      streamExportCsv: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CampaignsController],
      providers: [
        { provide: CampaignsService, useValue: campaignsService },
        { provide: CancelAndReissueService, useValue: {} },
        { provide: BudgetService, useValue: {} },
      ],
    }).compile();

    controller = module.get(CampaignsController);
  });

  describe('exportCampaigns', () => {
    async function* fakeCsv() {
      await Promise.resolve();
      yield 'id,name\r\n';
      yield '"c1","Winter Relief"\r\n';
      yield '"c2","Summer Drive"\r\n';
    }

    it('streams the CSV body as separate chunks instead of buffering it whole', async () => {
      campaignsService.countExport.mockResolvedValue(2);
      campaignsService.streamExportCsv.mockReturnValue(fakeCsv());

      const res = makeMockResponse();
      const chunks: string[] = [];
      res.on('data', chunk => chunks.push(chunk.toString()));

      await controller.exportCampaigns({}, res);

      // Proof of streaming, not buffering: the response body arrived as
      // multiple discrete writes (one per generator yield), not a single
      // write of the fully-assembled string.
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(
        'id,name\r\n"c1","Winter Relief"\r\n"c2","Summer Drive"\r\n',
      );
    });

    it('sets CSV response headers, including total count', async () => {
      campaignsService.countExport.mockResolvedValue(2);
      campaignsService.streamExportCsv.mockReturnValue(fakeCsv());

      const res = makeMockResponse();
      res.resume(); // drain so the pipeline completes without a reader attached

      await controller.exportCampaigns({}, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv; charset=utf-8',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment; filename="campaigns-export-'),
      );
      expect(res.setHeader).toHaveBeenCalledWith('X-Total-Count', '2');
    });

    it('requires the operator or admin role', () => {
      const reflector = new Reflector();
      const roles = reflector.get(
        ROLES_KEY,
        CampaignsController.prototype.exportCampaigns,
      );

      expect(roles).toEqual([AppRole.operator, AppRole.admin]);
    });
  });
});
