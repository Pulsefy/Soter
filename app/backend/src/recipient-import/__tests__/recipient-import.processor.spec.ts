import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RecipientImportProcessor } from '../recipient-import.processor';
import { RecipientImportService } from '../recipient-import.service';
import { ClaimsService } from '../../claims/claims.service';

describe('RecipientImportProcessor', () => {
  let tempDir: string;
  let csvPath: string;
  let recipientImportService: jest.Mocked<Partial<RecipientImportService>>;
  let claimsService: jest.Mocked<Partial<ClaimsService>>;
  let processor: RecipientImportProcessor;
  let job: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'soter-import-test-'));
    csvPath = join(tempDir, 'recipients.csv');
    writeFileSync(
      csvPath,
      'recipientRef,amount,evidenceRef\nR-001,100,ev-1\nR-002,200,ev-2\nR-003,300,ev-3',
    );

    recipientImportService = {
      setJobProcessing: jest.fn().mockResolvedValue(true),
      getResumeState: jest.fn().mockResolvedValue({
        id: 'import-job-1',
        status: 'processing',
        campaignId: 'campaign-1',
        fileName: 'recipients.csv',
        filePath: csvPath,
        totalRows: 3,
        processedRows: 0,
        errorRows: 0,
        checkpointRow: 0,
        errors: [],
      }),
      parseCsv: jest.fn((content: string) => {
        const [header, ...rows] = content.split('\n');
        return {
          headers: header.split(','),
          rows: rows.map(row => row.split(',')),
        };
      }),
      validateRow: jest.fn((row: string[], _headers: string[], rowIndex) => ({
        valid: true,
        recipientRef: row[0],
        amount: Number(row[1]),
        evidenceRef: row[2],
        errors: [],
        rowIndex,
      })),
      isCancellationRequested: jest.fn().mockResolvedValue(false),
      hasImportedRow: jest.fn().mockResolvedValue(false),
      updateJobProgress: jest.fn().mockResolvedValue(undefined),
      completeJob: jest.fn().mockResolvedValue(undefined),
    };

    claimsService = {
      create: jest.fn().mockResolvedValue({ id: 'claim-1' }),
    };

    processor = new RecipientImportProcessor(
      recipientImportService as RecipientImportService,
      claimsService as ClaimsService,
    );

    job = {
      id: 'import-job-1',
      data: {
        jobId: 'import-job-1',
        campaignId: 'campaign-1',
        fileName: 'recipients.csv',
        filePath: csvPath,
        totalRows: 3,
      },
      updateProgress: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resumes from the last durable checkpoint', async () => {
    recipientImportService.getResumeState!.mockResolvedValue({
      id: 'import-job-1',
      status: 'processing',
      campaignId: 'campaign-1',
      fileName: 'recipients.csv',
      filePath: csvPath,
      totalRows: 3,
      processedRows: 1,
      errorRows: 0,
      checkpointRow: 1,
      errors: [],
    });

    await processor.process(job);

    expect(claimsService.create).toHaveBeenCalledTimes(2);
    expect(claimsService.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        recipientRef: 'R-002',
        importJobId: 'import-job-1',
        importRowNumber: 3,
      }),
    );
    expect(recipientImportService.completeJob).toHaveBeenCalledWith(
      'import-job-1',
      3,
      0,
      [],
      null,
    );
  });

  it('skips an already imported row when the checkpoint lagged', async () => {
    recipientImportService.hasImportedRow!.mockImplementation(
      (_jobId, rowNumber) => Promise.resolve(rowNumber === 2),
    );

    await processor.process(job);

    expect(claimsService.create).toHaveBeenCalledTimes(2);
    expect(claimsService.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ importRowNumber: 2 }),
    );
    expect(recipientImportService.updateJobProgress).toHaveBeenCalledWith(
      'import-job-1',
      1,
      0,
      [],
    );
  });

  it('stops promptly when cancellation is requested', async () => {
    recipientImportService
      .isCancellationRequested!.mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await processor.process(job);

    expect(claimsService.create).toHaveBeenCalledTimes(1);
    expect(recipientImportService.completeJob).not.toHaveBeenCalled();
    expect(recipientImportService.updateJobProgress).toHaveBeenCalledWith(
      'import-job-1',
      1,
      0,
      [],
    );
  });
});
