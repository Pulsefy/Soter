import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RecipientImportService } from '../recipient-import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

describe('RecipientImportService', () => {
  let service: RecipientImportService;
  let prismaService: PrismaService;

  const mockAuditService = {
    record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  };

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipientImportService,
        {
          provide: PrismaService,
          useValue: {
            campaign: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ id: 'campaign-1', name: 'Test Campaign' }),
            },
            importJob: {
              create: jest.fn().mockResolvedValue({
                id: 'import-job-1',
                campaignId: 'campaign-1',
                fileName: 'recipients.csv',
                totalRows: 10,
                status: 'pending',
                processedRows: 0,
                errorRows: 0,
                errors: null,
                reportUrl: null,
                completedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
              findUnique: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
          },
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: 'BullQueue_recipient-import',
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<RecipientImportService>(RecipientImportService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('createJob', () => {
    it('should create a job and return a valid job ID', async () => {
      const result = await service.createJob(
        'campaign-1',
        'recipients.csv',
        '/tmp/recipients.csv',
        100,
      );

      expect(result.jobId).toBeDefined();
      expect(typeof result.jobId).toBe('string');
      expect(result.totalRows).toBe(100);
      expect(result.status).toBe('pending');
      expect(prismaService.importJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            campaignId: 'campaign-1',
            fileName: 'recipients.csv',
            totalRows: 100,
          }),
        }),
      );
    });

    it('should throw BadRequestException if campaign does not exist', async () => {
      (prismaService.campaign.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createJob('non-existent', 'file.csv', '/tmp/file.csv', 10),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if totalRows is zero', async () => {
      await expect(
        service.createJob('campaign-1', 'file.csv', '/tmp/file.csv', 0),
      ).rejects.toThrow(BadRequestException);
    });

    it('should record an audit log on creation', async () => {
      await service.createJob('campaign-1', 'file.csv', '/tmp/file.csv', 50);

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'ImportJob',
          action: 'created',
        }),
      );
    });
  });

  describe('getJobStatus', () => {
    it('should return job status with progress percentage', async () => {
      (prismaService.importJob.findUnique as jest.Mock).mockResolvedValue({
        id: 'import-job-1',
        campaignId: 'campaign-1',
        fileName: 'recipients.csv',
        totalRows: 100,
        processedRows: 50,
        errorRows: 5,
        errors: JSON.stringify([
          { row: 1, field: 'amount', message: 'Invalid' },
        ]),
        reportUrl: null,
        status: 'processing',
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getJobStatus('import-job-1');

      expect(result.id).toBe('import-job-1');
      expect(result.status).toBe('processing');
      expect(result.totalRows).toBe(100);
      expect(result.processedRows).toBe(50);
      expect(result.errorRows).toBe(5);
      expect(result.progress).toBe(50);
      expect(result.errors).toHaveLength(1);
    });

    it('should throw NotFoundException if job does not exist', async () => {
      (prismaService.importJob.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getJobStatus('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle zero totalRows without division by zero', async () => {
      (prismaService.importJob.findUnique as jest.Mock).mockResolvedValue({
        id: 'import-job-1',
        campaignId: 'campaign-1',
        fileName: 'recipients.csv',
        totalRows: 0,
        processedRows: 0,
        errorRows: 0,
        errors: null,
        reportUrl: null,
        status: 'pending',
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getJobStatus('import-job-1');
      expect(result.progress).toBe(0);
    });
  });

  describe('progress tracking', () => {
    it('should update job progress with correct counts', async () => {
      await service.updateJobProgress('import-job-1', 75, 3, [
        { row: 1, field: 'amount', message: 'Invalid' },
      ]);

      expect(prismaService.importJob.update).toHaveBeenCalledWith({
        where: { id: 'import-job-1' },
        data: {
          processedRows: 75,
          errorRows: 3,
          errors: JSON.stringify([
            { row: 1, field: 'amount', message: 'Invalid' },
          ]),
        },
      });
    });

    it('should set errors to null when there are no errors', async () => {
      await service.updateJobProgress('import-job-1', 100, 0, []);

      expect(prismaService.importJob.update).toHaveBeenCalledWith({
        where: { id: 'import-job-1' },
        data: {
          processedRows: 100,
          errorRows: 0,
          errors: null,
        },
      });
    });
  });

  describe('completeJob', () => {
    it('should set status to completed when no errors', async () => {
      await service.completeJob('import-job-1', 100, 0, [], null);

      expect(prismaService.importJob.update).toHaveBeenCalledWith({
        where: { id: 'import-job-1' },
        data: expect.objectContaining({
          status: 'completed',
          completedAt: expect.any(Date),
        }),
      });
    });

    it('should set status to failed when there are errors', async () => {
      await service.completeJob(
        'import-job-1',
        95,
        5,
        [{ row: 1, field: 'amount', message: 'Invalid' }],
        '/report.csv',
      );

      expect(prismaService.importJob.update).toHaveBeenCalledWith({
        where: { id: 'import-job-1' },
        data: expect.objectContaining({
          status: 'failed',
          reportUrl: '/report.csv',
          completedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('CSV parsing', () => {
    it('should parse a well-formed CSV', () => {
      const csv =
        'recipientRef,amount,evidenceRef\nR-001,100.00,ev-1\nR-002,200.50,';
      const result = service.parseCsv(csv);

      expect(result.headers).toEqual(['recipientRef', 'amount', 'evidenceRef']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual(['R-001', '100.00', 'ev-1']);
      expect(result.rows[1]).toEqual(['R-002', '200.50', '']);
    });

    it('should handle quoted fields with commas', () => {
      const csv = 'recipientRef,amount\n"R-001, Jr.",100.00';
      const result = service.parseCsv(csv);

      expect(result.rows[0]).toEqual(['R-001, Jr.', '100.00']);
    });

    it('should throw BadRequestException on empty CSV', () => {
      expect(() => service.parseCsv('')).toThrow(BadRequestException);
    });
  });

  describe('row validation', () => {
    const headers = ['recipientRef', 'amount', 'evidenceRef'];

    it('should validate a correct row', () => {
      const result = service.validateRow(
        ['R-001', '100.00', 'ev-1'],
        headers,
        2,
      );
      expect(result.valid).toBe(true);
      expect(result.recipientRef).toBe('R-001');
      expect(result.amount).toBe(100);
    });

    it('should fail when recipientRef is missing', () => {
      const result = service.validateRow(['', '100.00', 'ev-1'], headers, 2);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'recipientRef')).toBe(true);
    });

    it('should fail when amount is invalid', () => {
      const result = service.validateRow(['R-001', 'abc', 'ev-1'], headers, 2);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'amount')).toBe(true);
    });

    it('should fail when amount is negative', () => {
      const result = service.validateRow(['R-001', '-50', 'ev-1'], headers, 2);
      expect(result.valid).toBe(false);
    });
  });

  describe('setJobProcessing', () => {
    it('should update status to processing', async () => {
      await service.setJobProcessing('import-job-1');

      expect(prismaService.importJob.update).toHaveBeenCalledWith({
        where: { id: 'import-job-1' },
        data: { status: 'processing' },
      });
    });
  });

  describe('generateReportCsv', () => {
    it('should generate CSV report when job has errors', async () => {
      (prismaService.importJob.findUnique as jest.Mock).mockResolvedValue({
        id: 'import-job-1',
        errors: JSON.stringify([
          { row: 2, field: 'amount', message: 'Invalid amount', value: 'abc' },
        ]),
      });

      const result = await service.generateReportCsv('import-job-1');
      expect(result).toContain('row,field,message,value');
      expect(result).toContain('2,"amount","Invalid amount","abc"');
    });

    it('should return no errors message when job has no errors', async () => {
      (prismaService.importJob.findUnique as jest.Mock).mockResolvedValue({
        id: 'import-job-1',
        errors: null,
      });

      const result = await service.generateReportCsv('import-job-1');
      expect(result).toContain('No errors found for this import.');
    });

    it('should throw NotFoundException if job does not exist', async () => {
      (prismaService.importJob.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.generateReportCsv('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
