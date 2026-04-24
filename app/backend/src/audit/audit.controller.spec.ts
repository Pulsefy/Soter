import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AppRole } from '../auth/app-role.enum';

describe('AuditController', () => {
  let controller: AuditController;
  let service: AuditService;

  const mockExportResult = {
    data: [
      {
        id: 'log-1',
        actorHash: 'abc123abc123abc1',
        entity: 'campaign',
        entityHash: 'def456def456def4',
        action: 'create',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        metadata: {},
      },
    ],
    total: 1,
    page: 1,
    limit: 50,
  };

  const mockAuditService = {
    findLogs: jest.fn().mockResolvedValue([]),
    exportLogs: jest.fn().mockResolvedValue(mockExportResult),
    buildCsv: jest.fn().mockReturnValue('id,actorHash,...\nlog-1,...'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    controller = module.get<AuditController>(AuditController);
    service = module.get<AuditService>(AuditService);
    jest.clearAllMocks();
    mockAuditService.exportLogs.mockResolvedValue(mockExportResult);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getLogs', () => {
    it('should call auditService.findLogs', async () => {
      const query = { entity: 'campaign' };
      await controller.getLogs(query);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.findLogs).toHaveBeenCalledWith(query);
    });
  });

  describe('exportLogs', () => {
    const makeRes = () => ({
      setHeader: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      statusCode: 200,
    });

    const makeReq = (role?: AppRole, ngoId?: string) => ({
      user: role ? { role, ngoId } : undefined,
    });

    it('should return the result object for JSON format', async () => {
      const res = makeRes();
      const req = makeReq(AppRole.admin);
      const returned = await controller.exportLogs(
        { page: 1, limit: 10 },
        req as any,
        res as any,
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.exportLogs).toHaveBeenCalledWith({ page: 1, limit: 10 }, undefined);
      expect(returned).toBe(mockExportResult);
    });

    it('should return CSV string and set headers when format=csv', async () => {
      const res = makeRes();
      const req = makeReq(AppRole.admin);
      const returned = await controller.exportLogs(
        { format: 'csv' } as any,
        req as any,
        res as any,
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.buildCsv).toHaveBeenCalledWith(mockExportResult.data);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(typeof returned).toBe('string');
    });

    it('should set pagination headers on every response', async () => {
      const res = makeRes();
      const req = makeReq(AppRole.admin);
      await controller.exportLogs({ page: 1, limit: 10 }, req as any, res as any);
      expect(res.setHeader).toHaveBeenCalledWith('X-Total-Count', '1');
      expect(res.setHeader).toHaveBeenCalledWith('X-Page', '1');
      expect(res.setHeader).toHaveBeenCalledWith('X-Limit', '50');
    });

    it('should enforce ngoId for NGO role callers', async () => {
      const res = makeRes();
      const req = makeReq(AppRole.ngo, 'org-42');
      await controller.exportLogs({ orgId: 'org-other' } as any, req as any, res as any);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.exportLogs).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-other' }),
        'org-42', // enforcedOrgId overrides query orgId
      );
    });

    it('should not enforce orgId for admin callers', async () => {
      const res = makeRes();
      const req = makeReq(AppRole.admin);
      await controller.exportLogs({ orgId: 'org-1' } as any, req as any, res as any);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.exportLogs).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-1' }),
        undefined,
      );
    });

    it('should pass actorId and action filters to exportLogs', async () => {
      const res = makeRes();
      const req = makeReq(AppRole.admin);
      await controller.exportLogs(
        { actorId: 'user-1', action: 'create' } as any,
        req as any,
        res as any,
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.exportLogs).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'user-1', action: 'create' }),
        undefined,
      );
    });
  });
});
