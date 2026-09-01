import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';
import { RecipientsService } from './recipients.service';

@ApiTags('Recipients')
@ApiBearerAuth('JWT-auth')
@Controller('recipients')
export class RecipientsController {
  constructor(private readonly recipientsService: RecipientsService) {}

  private requireCsvFile(
    file: Express.Multer.File | undefined,
  ): Express.Multer.File {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(
        'A CSV file must be uploaded in the "file" field.',
      );
    }
    return file;
  }

  @Post('import/validate')
  @Roles(AppRole.admin, AppRole.ngo)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Validate an uploaded recipient CSV and return row-level results',
  })
  @ApiConsumes('multipart/form-data')
  validateImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('campaignId') campaignId?: string,
  ) {
    const csvFile = this.requireCsvFile(file);
    const outcome = this.recipientsService.validateImport(
      csvFile.buffer.toString('utf-8'),
    );

    return {
      success: true,
      campaignId: campaignId ?? 'unknown-campaign',
      summary: outcome.summary,
      rows: outcome.rows.map(({ values: _values, ...row }) => row),
    };
  }

  @Post('import/report')
  @Roles(AppRole.admin, AppRole.ngo)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      'Generate and download the structured import validation report (CSV)',
  })
  @ApiConsumes('multipart/form-data')
  downloadImportReport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('campaignId') campaignId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csvFile = this.requireCsvFile(file);
    const resolvedCampaignId =
      campaignId && campaignId.trim() ? campaignId.trim() : 'unknown-campaign';
    const outcome = this.recipientsService.validateImport(
      csvFile.buffer.toString('utf-8'),
    );
    const report = this.recipientsService.buildImportReport(
      resolvedCampaignId,
      outcome,
    );

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report.meta.filename}"`,
      'X-Report-Id': report.meta.reportId,
      'X-Report-Generated-At': report.meta.generatedAt,
    });

    return report.csv;
  }

  @Post('import/confirm')
  @Roles(AppRole.admin, AppRole.ngo)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Confirm a validated recipient import' })
  @ApiConsumes('multipart/form-data')
  confirmImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('campaignId') campaignId?: string,
  ) {
    const csvFile = this.requireCsvFile(file);

    return {
      success: true,
      message: `Recipient import queued successfully for ${csvFile.originalname ?? 'recipients.csv'}${
        campaignId ? ` (campaign ${campaignId})` : ''
      }.`,
    };
  }
}
