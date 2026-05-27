import {
  Controller,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
  Inject,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { OnchainAdapter, ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
import { SorobanErrorMapper } from './utils/soroban-error.mapper';

/**
 * TransactionController
 * REST API endpoints for querying Soroban transaction status
 */
@ApiTags('Onchain - Transactions')
@Controller('onchain/transactions')
export class TransactionController {
  private readonly logger = new Logger(TransactionController.name);
  private readonly errorMapper = new SorobanErrorMapper();

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
  ) {}

  /**
   * Get transaction status
   * GET /onchain/transactions/:hash/status
   */
  @Get(':hash/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get transaction status',
    description:
      'Polls the blockchain network to get the status of a specific transaction by its hash. Useful for clients to show progress while waiting for a transaction to complete.',
  })
  @ApiOkResponse({
    description: 'Transaction status retrieved successfully.',
    schema: {
      example: {
        transactionHash:
          'ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABCD',
        status: 'pending',
        timestamp: '2026-03-30T12:30:00.000Z',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to retrieve transaction status.',
  })
  async getTransactionStatus(@Param('hash') hash: string): Promise<any> {
    try {
      return await this.onchainAdapter.getTransactionStatus({
        transactionHash: hash,
      });
    } catch (error) {
      this.logger.error(`Failed to get transaction status for hash ${hash}:`, error);
      this.errorMapper.throwMappedError(error);
    }
  }
}
