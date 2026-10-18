import { AppException, ERROR_CODES } from '../common/dto/error-response.dto';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';
import { RecipientsService } from './recipients.service';
import {
  RecipientRemovalDto,
  RecipientRemovalQueryDto,
} from './dto/recipient-removal.dto';

@ApiTags('Recipients')
@ApiBearerAuth('JWT-auth')
@Controller('recipients')
export class RecipientsController {
  constructor(private readonly recipientsService: RecipientsService) {}

  @Delete(':recipientRef')
  @Roles(AppRole.admin, AppRole.ngo)
  @ApiOperation({
    summary: 'Record the removal of a recipient',
    description:
      'Requires a structured reason code. Creates an immutable removal record; historical claims remain unchanged.',
  })
  @ApiOkResponse({ description: 'Recipient removal recorded.' })
  @ApiBadRequestResponse({ description: 'A valid reason code is required.' })
  @ApiUnauthorizedResponse({
    description: 'An authenticated actor is required.',
  })
  @ApiForbiddenResponse({
    description: 'An organization scope is required for NGO actors.',
  })
  remove(
    @Param('recipientRef') recipientRef: string,
    @Body() dto: RecipientRemovalDto,
    @Req() req: Request,
  ) {
    if (!dto?.reasonCode) {
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        'A recipient removal reason code is required.',
      );
    }
    const actorId = req.user?.sub ?? req.user?.id ?? req.user?.apiKeyId;
    if (!actorId) {
      throw new UnauthorizedException(
        'An authenticated actor is required to remove a recipient.',
      );
    }
    const ngoId = this.getNgoScope(req);
    return this.recipientsService.remove(
      recipientRef,
      dto.reasonCode,
      dto.reason,
      actorId,
      ngoId,
    );
  }

  @Get('removals')
  @Roles(AppRole.admin, AppRole.ngo)
  @ApiOperation({
    summary: 'Query recipient removal records',
    description:
      'Returns removal records independently of the general audit log. Results can be filtered by recipient reference.',
  })
  @ApiOkResponse({ description: 'Recipient removal records retrieved.' })
  @ApiForbiddenResponse({
    description: 'An organization scope is required for NGO actors.',
  })
  findRemovals(@Query() query: RecipientRemovalQueryDto, @Req() req: Request) {
    return this.recipientsService.findRemovals(query, this.getNgoScope(req));
  }

  private getNgoScope(req: Request): string | undefined {
    if (req.user?.role !== AppRole.ngo) {
      return undefined;
    }
    if (!req.user.ngoId) {
      throw new ForbiddenException(
        'An organization scope is required for recipient removals.',
      );
    }
    return req.user.ngoId;
  }

  private requireCsvFile(
    file: Express.Multer.File | undefined,
  ): Express.Multer.File {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
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
