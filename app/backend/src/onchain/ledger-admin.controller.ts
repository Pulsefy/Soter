import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  Version,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { LedgerBackfillService } from './ledger-backfill.service';
import { LedgerReconciliationService } from './ledger-reconciliation.service';
import { BackfillCheckpointService } from './backfill-checkpoint.service';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

@ApiTags('Ledger Admin')
@Controller('admin/ledger')
export class LedgerAdminController {
  constructor(
    private readonly backfillService: LedgerBackfillService,
    private readonly reconciliationService: LedgerReconciliationService,
    private readonly checkpointService: BackfillCheckpointService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Backfill endpoints
  // ──────────────────────────────────────────────────────────────────────────

  @Post('backfill')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Trigger ledger backfill job',
    description:
      'Enqueue a backfill job for the given ledger range.  If a checkpoint ' +
      'already exists for the same range/campaign the job resumes from where ' +
      'it left off rather than starting over (idempotent).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['startLedger', 'endLedger'],
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
          description: 'Optional campaign ID to scope the backfill',
        },
        batchSize: {
          type: 'number',
          description: 'Ledgers per processing batch (default: 100)',
        },
      },
    },
  })
  @ApiAcceptedResponse({
    description: 'Backfill job accepted.',
    schema: {
      example: {
        jobId: 'backfill:1000:2000',
        jobKey: 'backfill:1000:2000',
        startLedger: 1000,
        endLedger: 2000,
        status: 'queued',
        processedCount: 0,
        totalLedgers: 1001,
        lastProcessedLedger: 999,
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid request parameters.' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — valid JWT token required.',
  })
  @ApiForbiddenResponse({ description: 'Forbidden — admin role required.' })
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

    if (!Number.isInteger(startLedger) || !Number.isInteger(endLedger)) {
      throw new BadRequestException(
        'startLedger and endLedger must be integers',
      );
    }
    if (startLedger > endLedger) {
      throw new BadRequestException('startLedger must be ≤ endLedger');
    }
    if (batchSize < 1 || batchSize > 1000) {
      throw new BadRequestException('batchSize must be between 1 and 1000');
    }

    return this.backfillService.triggerBackfill(
      startLedger,
      endLedger,
      campaignId,
      batchSize,
    );
  }

  @Get('backfill/:jobKey')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get backfill job status',
    description: 'Retrieve progress and checkpoint state for a backfill job.',
  })
  @ApiParam({
    name: 'jobKey',
    description: 'Job key or job ID from triggerBackfill',
  })
  @ApiOkResponse({ description: 'Status retrieved.' })
  @ApiNotFoundResponse({ description: 'Job not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  async getBackfillStatus(@Param('jobKey') jobKey: string) {
    const status = await this.backfillService.getBackfillStatus(jobKey);
    if (!status) {
      throw new NotFoundException(`Backfill job not found: ${jobKey}`);
    }
    return status;
  }

  @Get('backfill')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'List backfill checkpoints',
    description: 'List recent backfill checkpoints with optional filters.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by status (pending|running|completed|failed)',
  })
  @ApiQuery({
    name: 'campaignId',
    required: false,
    description: 'Filter by campaign ID',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum rows to return (default 50)',
  })
  @ApiOkResponse({ description: 'Checkpoint list retrieved.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  async listBackfills(
    @Query('status') status?: string,
    @Query('campaignId') campaignId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.checkpointService.listCheckpoints({
      status: status as 'pending' | 'running' | 'completed' | 'failed' | undefined,
      campaignId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('backfill/:jobKey/resume')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Resume a failed or interrupted backfill',
    description:
      'Re-enqueue a previously failed or interrupted backfill.  ' +
      'Processing resumes from the last successfully saved checkpoint.',
  })
  @ApiParam({ name: 'jobKey', description: 'Job key to resume' })
  @ApiAcceptedResponse({ description: 'Backfill re-queued for resume.' })
  @ApiNotFoundResponse({ description: 'Checkpoint not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  async resumeBackfill(@Param('jobKey') jobKey: string) {
    const checkpoint = await this.checkpointService.getCheckpoint(jobKey);
    if (!checkpoint) {
      throw new NotFoundException(`Checkpoint not found: ${jobKey}`);
    }
    if (checkpoint.status === 'completed') {
      throw new BadRequestException(
        'Backfill already completed. Trigger a new one if needed.',
      );
    }

    return this.backfillService.triggerBackfill(
      checkpoint.startLedger,
      checkpoint.endLedger,
      checkpoint.campaignId ?? undefined,
      checkpoint.batchSize,
    );
  }

  @Delete('backfill/:jobKey')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a backfill checkpoint',
    description: 'Remove a checkpoint record. Does not affect queued jobs.',
  })
  @ApiParam({ name: 'jobKey', description: 'Job key to delete' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  async deleteCheckpoint(@Param('jobKey') jobKey: string): Promise<void> {
    await this.checkpointService.deleteCheckpoint(jobKey);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reconciliation endpoints (unchanged)
  // ──────────────────────────────────────────────────────────────────────────

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
      required: ['startLedger', 'endLedger'],
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
    },
  })
  @ApiAcceptedResponse({ description: 'Reconciliation job queued.' })
  @ApiBadRequestResponse({ description: 'Invalid request parameters.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
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
      throw new BadRequestException('startLedger must be ≤ endLedger');
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
  @ApiOkResponse({ description: 'Reconciliation status retrieved.' })
  @ApiNotFoundResponse({ description: 'Job not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  async getReconciliationStatus(@Param('jobId') jobId: string) {
    const status =
      await this.reconciliationService.getReconciliationStatus(jobId);
    if (!status) {
      throw new NotFoundException(`Reconciliation job not found: ${jobId}`);
    }
    return status;
  }
}
