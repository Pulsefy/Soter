import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';
import {
  StuckTransactionInfo,
  StuckTransactionMetrics,
} from './stuck-transaction.types';

@ApiTags('Admin — Soroban Transactions')
@Controller('admin/soroban-transactions')
export class StuckTransactionController {
  constructor(
    private readonly lifecycleService: SorobanTransactionLifecycleService,
  ) {}

  @Get('stuck')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List stuck Soroban transactions',
    description:
      'Returns all transactions that have been in a non-terminal state ' +
      'longer than the configured age threshold.',
  })
  @ApiQuery({
    name: 'operationType',
    required: false,
    description: 'Filter by operation type',
  })
  @ApiQuery({
    name: 'retryableOnly',
    required: false,
    description: 'If true, return only retryable transactions',
    enum: ['true', 'false'],
  })
  @ApiResponse({ status: 200, description: 'List of stuck transactions' })
  async getStuckTransactions(
    @Query('operationType') operationType?: string,
    @Query('retryableOnly') retryableOnly?: string,
  ): Promise<StuckTransactionInfo[]> {
    let stuck = await this.lifecycleService.getStuckTransactions();

    if (operationType) {
      stuck = stuck.filter(
        tx => tx.operationType.toLowerCase() === operationType.toLowerCase(),
      );
    }

    if (retryableOnly === 'true') {
      stuck = stuck.filter(tx => tx.isRetryable);
    }

    return stuck;
  }

  @Get('stuck/metrics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stuck transaction metrics',
    description:
      'Returns aggregated counts of stuck transactions grouped by operation type.',
  })
  @ApiResponse({ status: 200, description: 'Stuck transaction metrics' })
  getStuckMetrics(): StuckTransactionMetrics {
    return this.lifecycleService.getStuckMetrics();
  }

  @Get('config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Current stuck-detection configuration',
  })
  getConfig() {
    return this.lifecycleService.getStuckDetectionConfig();
  }
}
