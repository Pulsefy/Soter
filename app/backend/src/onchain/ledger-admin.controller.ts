import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
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
  ApiQuery,
} from '@nestjs/swagger';
import { LedgerBackfillService } from './ledger-backfill.service';
import { LedgerReconciliationService } from './ledger-reconciliation.service';
import { StateReconciliationService } from './state-reconciliation.service';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

@ApiTags('Ledger Admin')
@Controller('admin/ledger')
export class LedgerAdminController {
  constructor(
    private readonly backfillService: LedgerBackfillService,
    private readonly reconciliationService: LedgerReconciliationService,
    private readonly stateReconciliationService: StateReconciliationService,
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

  /* ================================================================ */
  /*  State reconciliation (on-chain ↔ backend drift detection)        */
  /* ================================================================ */

  @Post('state-reconciliation')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trigger on-chain ↔ backend state reconciliation',
    description:
      'Compares every AidPackage status and campaign locked-total against the on-chain contract, persists any drift incidents, and returns the report.',
  })
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        campaignId: {
          type: 'string',
          description:
            'Optional – scope reconciliation to a single campaign',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Reconciliation completed.',
    schema: {
      example: {
        triggeredAt: '2026-05-27T12:00:00.000Z',
        durationMs: 1234,
        driftsDetected: 1,
        drifts: [
          {
            packageId: 'pkg_abc',
            kind: 'status_mismatch',
            severity: 'high',
            description: '…',
          },
        ],
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  async triggerStateReconciliation(
    @Body() body?: { campaignId?: string },
  ) {
    return this.stateReconciliationService.reconcile(body?.campaignId);
  }

  @Get('drift-incidents')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'List recorded drift incidents',
    description:
      'Returns a paginated list of drift incidents, filterable by campaign, kind, severity, and resolution status.',
  })
  @ApiQuery({ name: 'campaignId', required: false })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'severity', required: false })
  @ApiQuery({ name: 'resolution', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiOkResponse({ description: 'Drift incident list.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  async listDriftIncidents(
    @Query('campaignId') campaignId?: string,
    @Query('kind') kind?: string,
    @Query('severity') severity?: string,
    @Query('resolution') resolution?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.stateReconciliationService.getDriftHistory({
      campaignId,
      kind,
      severity,
      resolution,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post('drift-incidents/:id/resolve')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a drift incident',
    description: 'Mark a drift incident as manually resolved with optional notes.',
  })
  @ApiParam({ name: 'id', description: 'Drift incident ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        resolvedBy: { type: 'string' },
        resolutionNotes: { type: 'string' },
      },
      required: ['resolvedBy'],
    },
  })
  @ApiOkResponse({ description: 'Incident resolved.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  async resolveDriftIncident(
    @Param('id') id: string,
    @Body() body: { resolvedBy: string; resolutionNotes?: string },
  ) {
    return this.stateReconciliationService.resolveDrift(
      id,
      body.resolvedBy,
      body.resolutionNotes,
    );
  }
}
