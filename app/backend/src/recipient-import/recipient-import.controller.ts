import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  HttpException,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiConsumes,
  ApiBody,
  ApiProduces,
} from '@nestjs/swagger';
import { RecipientImportService } from './recipient-import.service';
import {
  ImportJobResponseDto,
  ImportJobCreatedDto,
} from './dto/import-job-response.dto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Response } from 'express';

@ApiTags('Recipient Import')
@Controller('recipient-import')
export class RecipientImportController {
  constructor(
    private readonly recipientImportService: RecipientImportService,
  ) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  @ApiOperation({
    summary: 'Upload a CSV file and create an import job',
    description:
      'Accepts a CSV file with recipient data, creates an import job, and returns the job ID for tracking progress.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'campaignId'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV file to upload',
        },
        campaignId: { type: 'string', description: 'Target campaign ID' },
      },
    },
  })
  @ApiOkResponse({ type: ImportJobCreatedDto })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('campaignId') campaignId: string,
  ): Promise<ImportJobCreatedDto> {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }

    if (!campaignId) {
      throw new HttpException('campaignId is required', HttpStatus.BAD_REQUEST);
    }

    if (!file.originalname.endsWith('.csv')) {
      throw new HttpException(
        'Only CSV files are accepted',
        HttpStatus.BAD_REQUEST,
      );
    }

    const uploadDir = join(tmpdir(), 'soter-imports');
    try {
      mkdirSync(uploadDir, { recursive: true });
    } catch {
      // Ignore directory already exists error
    }

    const filePath = join(uploadDir, `${Date.now()}-${file.originalname}`);
    writeFileSync(filePath, file.buffer);

    const content = file.buffer.toString('utf-8');
    const { rows } = this.recipientImportService.parseCsv(content);
    const totalRows = rows.length;

    const result = await this.recipientImportService.createJob(
      campaignId,
      file.originalname,
      filePath,
      totalRows,
    );

    return {
      jobId: result.jobId,
      totalRows: result.totalRows,
      status: result.status as ImportJobCreatedDto['status'],
    };
  }

  @Get(':jobId')
  @ApiOperation({
    summary: 'Get import job status and progress',
    description:
      'Returns the current status, progress percentages, row counts, and any errors for the specified import job.',
  })
  @ApiOkResponse({ type: ImportJobResponseDto })
  async getStatus(
    @Param('jobId') jobId: string,
  ): Promise<ImportJobResponseDto> {
    return this.recipientImportService.getJobStatus(jobId);
  }

  @Post(':jobId/cancel')
  @ApiOperation({
    summary: 'Cancel an import job',
    description:
      'Requests cancellation for a pending or running import job. Active processors observe cancellation between rows.',
  })
  @ApiOkResponse({ type: ImportJobResponseDto })
  async cancelJob(
    @Param('jobId') jobId: string,
  ): Promise<ImportJobResponseDto> {
    return this.recipientImportService.cancelJob(jobId);
  }

  @Get(':jobId/report')
  @ApiOperation({
    summary: 'Download structured validation report (CSV)',
    description:
      'Returns a downloadable CSV file containing all row-level validation errors for the import job.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'CSV file containing import validation errors',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async downloadReport(
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ): Promise<void> {
    const csvContent =
      await this.recipientImportService.generateReportCsv(jobId);

    const filename = `import-report-${jobId}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', Buffer.byteLength(csvContent, 'utf8'));

    res.status(HttpStatus.OK).send(csvContent);
  }
}
