import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Version,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { LedgerBackfillService } from './ledger-backfill.service';
import { LedgerReconciliationService } from './ledger-reconciliation.service';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

@ApiTags('Ledger Admin')
@Controller('admin/ledger')
export class LedgerAdminController {
  constructor(
    private readonly backfillService: LedgerBackfillService,
    private readonly reconciliationService: LedgerReconciliationService,
  ) {}

  @Post('backfill')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Trigger ledger backfill job',
    description:
      'Start a backfill job to process a range of ledgers and populate missing ledger entries. Idempotent - can be run repeatedly without duplicating data.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        startLedger: {
          type: 'number',
          description: 'Starting ledger sequence number',
        },
        endLedger: {
          type: 'number',
          description: 'Ending ledger sequence number',
        },
        campaignId: {
          type: 'string',
          description: 'Optional campaign ID to filter',
        },
        batchSize: {
          type: 'number',
          description: 'Number of ledgers to process per batch (default: 100)',
        },
      },
      required: ['startLedger', 'endLedger'],
    },
  })
  @ApiOkResponse({
    description: 'Backfill job queued successfully.',
    schema: {
      example: {
        jobId: 'job_123',
        startLedger: 1000,
        endLedger: 2000,
        status: 'queued',
        processedCount: 0,
        totalCount: 1001,
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid request parameters.',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async triggerBackfill(
    @Body()
    body: {
      startLedger: number;
      endLedger: number;
      campaignId?: string;
      batchSize?: number;
    },
  ) {
    const { startLedger, endLedger, campaignId, batchSize = 100 } = body;

    if (startLedger > endLedger) {
      throw new Error('startLedger must be less than or equal to endLedger');
    }

    return this.backfillService.triggerBackfill(
      startLedger,
      endLedger,
      campaignId,
      batchSize,
    );
  }

  @Get('backfill/:jobId')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get backfill job status',
    description: 'Retrieve the current status of a backfill job.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'Job ID returned from triggerBackfill',
  })
  @ApiOkResponse({
    description: 'Backfill status retrieved successfully.',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async getBackfillStatus(@Param('jobId') jobId: string) {
    const status = await this.backfillService.getBackfillStatus(jobId);
    if (!status) {
      throw new Error('Job not found');
    }
    return status;
  }

  @Post('reconcile')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Trigger ledger reconciliation job',
    description:
      'Start a reconciliation job to compare on-chain data against stored records and detect discrepancies.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        startLedger: {
          type: 'number',
          description: 'Starting ledger sequence number',
        },
        endLedger: {
          type: 'number',
          description: 'Ending ledger sequence number',
        },
        campaignId: {
          type: 'string',
          description: 'Optional campaign ID to filter',
        },
        thresholdPercent: {
          type: 'number',
          description: 'Threshold percentage for amount mismatch (default: 5)',
        },
      },
      required: ['startLedger', 'endLedger'],
    },
  })
  @ApiOkResponse({
    description: 'Reconciliation job queued successfully.',
    schema: {
      example: {
        jobId: 'job_456',
        startLedger: 1000,
        endLedger: 2000,
        status: 'queued',
        totalLedgers: 1001,
        checkedLedgers: 0,
        discrepancies: [],
        summary: {
          totalDiscrepancies: 0,
          bySeverity: { low: 0, medium: 0, high: 0 },
          byType: { missing: 0, amount_mismatch: 0, count_mismatch: 0 },
        },
        actionable: false,
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid request parameters.',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async triggerReconciliation(
    @Body()
    body: {
      startLedger: number;
      endLedger: number;
      campaignId?: string;
      thresholdPercent?: number;
    },
  ) {
    const { startLedger, endLedger, campaignId, thresholdPercent = 5 } = body;

    if (startLedger > endLedger) {
      throw new Error('startLedger must be less than or equal to endLedger');
    }

    return this.reconciliationService.triggerReconciliation(
      startLedger,
      endLedger,
      campaignId,
      thresholdPercent,
    );
  }

  @Get('reconcile/:jobId')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get reconciliation job status',
    description:
      'Retrieve the current status and report of a reconciliation job.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'Job ID returned from triggerReconciliation',
  })
  @ApiOkResponse({
    description: 'Reconciliation status retrieved successfully.',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async getReconciliationStatus(@Param('jobId') jobId: string) {
    const status =
      await this.reconciliationService.getReconciliationStatus(jobId);
    if (!status) {
      throw new Error('Job not found');
    }
    return status;
  }
}
