import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

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
    findLogs: jest
      .fn()
      .mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
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
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getLogs', () => {
    it('should call auditService.findLogs and set pagination headers', async () => {
      const query = { entity: 'campaign' };
      const res = {
        setHeader: jest.fn(),
      } as any;

      await controller.getLogs(query as any, res);

      expect(service.findLogs).toHaveBeenCalledWith(query);
      expect(res.setHeader).toHaveBeenCalledWith('X-Total-Count', '0');
      expect(res.setHeader).toHaveBeenCalledWith('X-Page', '1');
      expect(res.setHeader).toHaveBeenCalledWith('X-Limit', '50');
    });
  });

  describe('exportLogs', () => {
    const makeRes = () => ({
      setHeader: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
    });

    it('should return the result object for JSON format', async () => {
      const res = makeRes();
      const returned = await controller.exportLogs(
        { page: 1, limit: 10 },
        res as any,
      );

      expect(service.exportLogs).toHaveBeenCalledWith({ page: 1, limit: 10 });
      expect(returned).toBe(mockExportResult);
    });

    it('should return CSV string and set headers when format=csv', async () => {
      const res = makeRes();
      const returned = await controller.exportLogs(
        { format: 'csv' } as any,
        res as any,
      );

      expect(service.buildCsv).toHaveBeenCalledWith(mockExportResult.data);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(typeof returned).toBe('string');
    });

    it('should set pagination headers on every response', async () => {
      const res = makeRes();
      await controller.exportLogs({ page: 1, limit: 10 }, res as any);
      expect(res.setHeader).toHaveBeenCalledWith('X-Total-Count', '1');
      expect(res.setHeader).toHaveBeenCalledWith('X-Page', '1');
      expect(res.setHeader).toHaveBeenCalledWith('X-Limit', '50');
    });

    it('should pass from/to filters to exportLogs', async () => {
      const res = makeRes();
      await controller.exportLogs(
        { from: '2024-01-01', to: '2024-12-31' } as any,
        res as any,
      );

      expect(service.exportLogs).toHaveBeenCalledWith({
        from: '2024-01-01',
        to: '2024-12-31',
      });
    });
  });
});
