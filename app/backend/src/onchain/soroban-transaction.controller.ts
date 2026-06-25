import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { SorobanTransactionService } from './soroban-transaction.service';
import { SorobanTransactionScheduler } from './soroban-transaction.scheduler';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { Roles } from '../auth/roles.decorator';
import { RoleGuard } from '../auth/role.guard';
import { AppRole } from '@prisma/client';

@ApiTags('Soroban Transactions')
@Controller('soroban-transactions')
@UseGuards(ApiKeyGuard, RoleGuard)
export class SorobanTransactionController {
  constructor(
    private readonly sorobanTransactionService: SorobanTransactionService,
    private readonly sorobanTransactionScheduler: SorobanTransactionScheduler,
  ) {}

  @Get(':id')
  @Roles(AppRole.admin, AppRole.operator)
  @ApiOperation({ summary: 'Get transaction status by ID' })
  @ApiParam({ name: 'id', description: 'Transaction ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Transaction status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        operation: { type: 'string' },
        status: { type: 'string' },
        txHash: { type: 'string', nullable: true },
        attemptCount: { type: 'number' },
        maxAttempts: { type: 'number' },
        lastError: { type: 'string', nullable: true },
        errorType: { type: 'string', nullable: true },
        isRetryable: { type: 'boolean' },
        nextRetryAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        submittedAt: { type: 'string', format: 'date-time', nullable: true },
        confirmedAt: { type: 'string', format: 'date-time', nullable: true },
        failedAt: { type: 'string', format: 'date-time', nullable: true },
        correlationId: { type: 'string', nullable: true },
        claim: {
          type: 'object',
          nullable: true,
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            amount: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Transaction not found' })
  async getTransaction(@Param('id') id: string) {
    return this.sorobanTransactionService.getTransactionStatus(id);
  }

  @Get('claim/:claimId')
  @Roles(AppRole.admin, AppRole.operator)
  @ApiOperation({ summary: 'Get all transactions for a specific claim' })
  @ApiParam({ name: 'claimId', description: 'Claim ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Claim transactions retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        claimId: { type: 'string' },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              operation: { type: 'string' },
              status: { type: 'string' },
              txHash: { type: 'string', nullable: true },
              attemptCount: { type: 'number' },
              maxAttempts: { type: 'number' },
              lastError: { type: 'string', nullable: true },
              errorType: { type: 'string', nullable: true },
              isRetryable: { type: 'boolean' },
              nextRetryAt: { type: 'string', format: 'date-time', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
              submittedAt: { type: 'string', format: 'date-time', nullable: true },
              confirmedAt: { type: 'string', format: 'date-time', nullable: true },
              failedAt: { type: 'string', format: 'date-time', nullable: true },
              correlationId: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  })
  async getClaimTransactions(@Param('claimId') claimId: string) {
    const transactions = await this.sorobanTransactionService.getClaimTransactions(claimId);
    return {
      claimId,
      transactions,
    };
  }

  @Post(':id/retry')
  @Roles(AppRole.admin)
  @ApiOperation({ summary: 'Manually retry a transaction' })
  @ApiParam({ name: 'id', description: 'Transaction ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Transaction retry initiated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Transaction not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Transaction cannot be retried' })
  async retryTransaction(
    @Param('id') id: string,
    @Body() body: { forceRetry?: boolean } = {},
  ) {
    await this.sorobanTransactionService.retryTransaction({
      transactionId: id,
      forceRetry: body.forceRetry || false,
    });

    return {
      success: true,
      message: 'Transaction retry initiated',
    };
  }

  @Get('retryable/list')
  @Roles(AppRole.admin, AppRole.operator)
  @ApiOperation({ summary: 'List all retryable transactions' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Retryable transactions retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              claimId: { type: 'string', nullable: true },
              operation: { type: 'string' },
              status: { type: 'string' },
              attemptCount: { type: 'number' },
              maxAttempts: { type: 'number' },
              lastError: { type: 'string', nullable: true },
              errorType: { type: 'string', nullable: true },
              nextRetryAt: { type: 'string', format: 'date-time', nullable: true },
              correlationId: { type: 'string', nullable: true },
            },
          },
        },
        count: { type: 'number' },
      },
    },
  })
  async getRetryableTransactions() {
    const transactions = await this.sorobanTransactionService.getRetryableTransactions();
    return {
      transactions,
      count: transactions.length,
    };
  }

  @Get('queue/stats')
  @Roles(AppRole.admin, AppRole.operator)
  @ApiOperation({ summary: 'Get transaction queue statistics' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Queue statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        waiting: { type: 'number' },
        active: { type: 'number' },
        completed: { type: 'number' },
        failed: { type: 'number' },
        delayed: { type: 'number' },
      },
    },
  })
  async getQueueStats() {
    return this.sorobanTransactionScheduler.getQueueStats();
  }

  @Post('queue/schedule')
  @Roles(AppRole.admin)
  @ApiOperation({ summary: 'Manually schedule a transaction for execution' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Transaction scheduled successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        jobId: { type: 'string' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Transaction not found' })
  async scheduleTransaction(
    @Body() body: {
      transactionId: string;
      delay?: number;
      priority?: number;
      correlationId?: string;
    },
  ) {
    const job = await this.sorobanTransactionScheduler.scheduleTransaction(
      body.transactionId,
      {
        delay: body.delay,
        priority: body.priority,
        correlationId: body.correlationId,
      },
    );

    return {
      success: true,
      jobId: job.id,
      message: 'Transaction scheduled successfully',
    };
  }

  @Post('cleanup/expired')
  @Roles(AppRole.admin)
  @ApiOperation({ summary: 'Manually trigger cleanup of expired transactions' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cleanup completed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        expiredCount: { type: 'number' },
        message: { type: 'string' },
      },
    },
  })
  async cleanupExpiredTransactions() {
    const expiredCount = await this.sorobanTransactionService.markExpiredTransactions();

    return {
      success: true,
      expiredCount,
      message: `Marked ${expiredCount} transactions as expired`,
    };
  }
}