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
  ApiConflictResponse,
} from '@nestjs/swagger';
import { LedgerBackfillService } from './ledger-backfill.service';
import { LedgerReconciliationService } from './ledger-reconciliation.service';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

@ApiTags('Ledger Admin')
@Controller('admin/ledger')
export class LedgerAdminController {
  constructor(
    private readonly backfillService: LedgerBackfillService,
    private readonly reconciliationService: LedgerReconciliationService,
    private readonly sorobanTransactionLifecycleService: SorobanTransactionLifecycleService,
  ) {}

  @Post('backfill')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Trigger ledger backfill job',
    description:
      'Start or resume a backfill job to process a range of ledgers and populate missing ledger entries. ' +
      'Uses a durable checkpoint so interrupted runs resume from `lastProcessedLedger` rather than restarting. ' +
      'Re-triggering the same range while a run is already in progress returns 409.',
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
        triggeredBy: {
          type: 'string',
          description: 'Optional actor identifier for audit trail',
        },
      },
      required: ['startLedger', 'endLedger'],
    },
  })
  @ApiAcceptedResponse({
    description: 'Backfill job queued or resumed successfully.',
    schema: {
      example: {
        jobId: 'job_123',
        checkpointId: 'ckp_abc',
        jobKey: 'backfill:1000:2000',
        startLedger: 1000,
        endLedger: 2000,
        status: 'queued',
        processedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        totalCount: 1001,
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid request parameters.' })
  @ApiConflictResponse({
    description: 'A backfill job for this range is already running.',
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
      triggeredBy?: string;
    },
  ) {
    const {
      startLedger,
      endLedger,
      campaignId,
      batchSize = 100,
      triggeredBy,
    } = body;

    if (startLedger > endLedger) {
      throw new Error('startLedger must be less than or equal to endLedger');
    }

    return this.backfillService.triggerBackfill(
      startLedger,
      endLedger,
      campaignId,
      batchSize,
      triggeredBy,
    );
  }

  @Get('backfill/checkpoints')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'List recent backfill checkpoints',
    description: 'Returns recent backfill checkpoint records, newest first.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of records to return (default: 20)',
  })
  @ApiOkResponse({ description: 'Checkpoint list retrieved successfully.' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async listCheckpoints(@Query('limit') limit?: string) {
    return this.backfillService.listCheckpoints(
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('backfill/checkpoint/:checkpointId')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get backfill checkpoint by ID',
    description: 'Retrieve a durable checkpoint record for a backfill run.',
  })
  @ApiParam({
    name: 'checkpointId',
    description: 'Checkpoint ID returned from triggerBackfill',
  })
  @ApiOkResponse({ description: 'Checkpoint retrieved successfully.' })
  @ApiNotFoundResponse({ description: 'Checkpoint not found.' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async getCheckpoint(@Param('checkpointId') checkpointId: string) {
    const checkpoint = await this.backfillService.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new NotFoundException(
        `Backfill checkpoint ${checkpointId} not found`,
      );
    }
    return checkpoint;
  }

  @Delete('backfill/checkpoint/:checkpointId')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cancel a running backfill',
    description:
      'Marks a running backfill checkpoint as cancelled. The current batch ' +
      'may still complete; the checkpoint is preserved so the run can be resumed later.',
  })
  @ApiParam({
    name: 'checkpointId',
    description: 'Checkpoint ID to cancel',
  })
  @ApiOkResponse({ description: 'Backfill cancelled.' })
  @ApiNotFoundResponse({ description: 'Checkpoint not found.' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async cancelBackfill(@Param('checkpointId') checkpointId: string) {
    await this.backfillService.cancelBackfill(checkpointId);
  }

  @Get('backfill/:jobId')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get backfill job status (by BullMQ job ID)',
    description:
      'Retrieve the current status of a backfill job. For richer progress data, prefer GET /backfill/checkpoint/:checkpointId.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'BullMQ job ID returned from triggerBackfill',
  })
  @ApiOkResponse({ description: 'Backfill status retrieved successfully.' })
  @ApiNotFoundResponse({ description: 'Job not found.' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async getBackfillStatus(@Param('jobId') jobId: string) {
    const status = await this.backfillService.getBackfillStatus(jobId);
    if (!status) {
      throw new NotFoundException(`Backfill job ${jobId} not found`);
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

  @Get('soroban/stuck')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'List stuck Soroban transactions',
    description:
      'Returns Soroban transactions that have been in a non-terminal state (pending or submitted) longer than the configured threshold (STUCK_TRANSACTION_THRESHOLD_MS). Each transaction is classified as `retryable` (expected to self-heal on a future retry) or `terminal` (non-retryable / retries exhausted, requiring operator intervention).',
  })
  @ApiOkResponse({
    description: 'Stuck transactions retrieved successfully.',
    schema: {
      example: {
        success: true,
        data: {
          stuckCount: 2,
          retryableCount: 1,
          terminalCount: 1,
          thresholdMs: 300000,
          byOperation: {
            create_claim: 1,
            disburse_claim: 1,
            init_escrow: 0,
          },
          transactions: [
            {
              id: 'tx_123',
              operation: 'create_claim',
              status: 'pending',
              errorType: 'network_timeout',
              lastError: 'timeout waiting for response',
              isRetryable: true,
              attemptCount: 2,
              maxAttempts: 5,
              classification: 'retryable',
              stuckAgeMs: 600000,
              updatedAt: '2026-08-25T20:00:00.000Z',
              createdAt: '2026-08-25T19:50:00.000Z',
              claimId: 'claim_456',
              correlationId: 'corr_789',
            },
            {
              id: 'tx_456',
              operation: 'disburse_claim',
              status: 'submitted',
              errorType: null,
              lastError: 'NotAuthorized',
              isRetryable: false,
              attemptCount: 5,
              maxAttempts: 5,
              classification: 'terminal',
              stuckAgeMs: 900000,
              updatedAt: '2026-08-25T19:45:00.000Z',
              createdAt: '2026-08-25T19:30:00.000Z',
              claimId: 'claim_789',
              correlationId: 'corr_790',
            },
          ],
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async getStuckSorobanTransactions() {
    const result =
      await this.sorobanTransactionLifecycleService.detectStuckTransactions();
    return { success: true, data: result };
  }
}
