import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Req,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AidEscrowService } from './aid-escrow.service';
import {
  CreateAidPackageDto,
  BatchCreateAidPackagesDto,
} from './dto/aid-escrow.dto';
import { SorobanErrorMapper } from './utils/soroban-error.mapper';

/**
 * AidEscrowController
 * REST API endpoints for interacting with the Soroban AidEscrow contract
 */
@ApiTags('Onchain - Aid Escrow')
@ApiBearerAuth('JWT-auth')
@Controller('onchain/aid-escrow')
export class AidEscrowController {
  private readonly logger = new Logger(AidEscrowController.name);
  private readonly errorMapper = new SorobanErrorMapper();

  constructor(private readonly aidEscrowService: AidEscrowService) {}

  /**
   * Create a single aid package
   * POST /onchain/aid-escrow/packages
   */
  @Post('packages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an aid package',
    description:
      'Creates a new aid package with specified recipient, amount, and expiration. Only authorized operators can create packages.',
  })
  @ApiCreatedResponse({
    description: 'Package created successfully.',
    schema: {
      example: {
        packageId: 'pkg_123456789',
        transactionHash:
          'ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABCD',
        timestamp: '2026-03-30T12:30:00.000Z',
        status: 'success',
        metadata: {
          contractId: 'CBAA...',
          operator: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid input parameters.' })
  @ApiInternalServerErrorResponse({
    description: 'Blockchain transaction failed.',
  })
  async createAidPackage(
    @Body() dto: CreateAidPackageDto,
    @Req() req: Request & { user?: { address?: string } },
  ): Promise<any> {
    try {
      const operatorAddress = req.user?.address || 'admin';
      return await this.aidEscrowService.createAidPackage(dto, operatorAddress);
    } catch (error) {
      this.logger.error('Failed to create aid package:', error);
      this.errorMapper.throwMappedError(error);
    }
  }

  /**
   * Create multiple aid packages in a batch
   * POST /onchain/aid-escrow/packages/batch
   */
  @Post('packages/batch')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Batch create aid packages',
    description:
      'Creates multiple aid packages for multiple recipients in a single transaction. More efficient than individual creation.',
  })
  @ApiCreatedResponse({
    description: 'Packages created successfully.',
    schema: {
      example: {
        packageIds: ['0', '1', '2'],
        transactionHash:
          'ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABCD',
        timestamp: '2026-03-30T12:30:00.000Z',
        status: 'success',
        metadata: {
          contractId: 'CBAA...',
          count: 3,
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid input or mismatched arrays.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Blockchain transaction failed.',
  })
  async batchCreateAidPackages(
    @Body() dto: BatchCreateAidPackagesDto,
    @Req() req: Request & { user?: { address?: string } },
  ): Promise<any> {
    if (dto.recipientAddresses.length !== dto.amounts.length) {
      throw new BadRequestException(
        'Recipients and amounts arrays must have the same length',
      );
    }

    const operatorAddress = req.user?.address || 'admin';
    try {
      return await this.aidEscrowService.batchCreateAidPackages(
        dto,
        operatorAddress,
      );
    } catch (error) {
      this.logger.error('Failed to batch create aid packages:', error);
      this.errorMapper.throwMappedError(error);
    }
  }

  /**
   * Claim an aid package as recipient
   * POST /onchain/aid-escrow/packages/:id/claim
   */
  @Post('packages/:id/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim an aid package',
    description:
      'Claims an aid package as the recipient, transferring the funds to their wallet. Can only be claimed once.',
  })
  @ApiOkResponse({
    description: 'Package claimed successfully.',
    schema: {
      example: {
        packageId: 'pkg_123456789',
        transactionHash:
          'ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABCD',
        timestamp: '2026-03-30T12:30:00.000Z',
        status: 'success',
        amountClaimed: '1000000000',
        metadata: {
          contractId: 'CBAA...',
          recipient: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Package not found or not claimable.' })
  @ApiNotFoundResponse({ description: 'Package does not exist.' })
  @ApiInternalServerErrorResponse({
    description: 'Blockchain transaction failed.',
  })
  async claimAidPackage(
    @Param('id') packageId: string,
    @Req() req: Request & { user?: { address?: string } },
  ): Promise<any> {
    const recipientAddress = req.user?.address;
    if (!recipientAddress) {
      throw new BadRequestException('Recipient address required');
    }

    try {
      return await this.aidEscrowService.claimAidPackage(
        { packageId },
        recipientAddress,
      );
    } catch (error) {
      this.logger.error('Failed to claim aid package:', error);
      this.errorMapper.throwMappedError(error);
    }
  }

  /**
   * Disburse an aid package (admin action)
   * POST /onchain/aid-escrow/packages/:id/disburse
   */
  @Post('packages/:id/disburse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disburse an aid package',
    description:
      'Disburses an aid package from the admin/operator, transferring funds to the recipient. Admin-only action.',
  })
  @ApiOkResponse({
    description: 'Package disbursed successfully.',
    schema: {
      example: {
        packageId: 'pkg_123456789',
        transactionHash:
          'ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABCD',
        timestamp: '2026-03-30T12:30:00.000Z',
        status: 'success',
        amountDisbursed: '1000000000',
        metadata: {
          contractId: 'CBAA...',
          operator: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Package not found or not disbursable.',
  })
  @ApiNotFoundResponse({ description: 'Package does not exist.' })
  @ApiInternalServerErrorResponse({
    description: 'Blockchain transaction failed.',
  })
  async disburseAidPackage(
    @Param('id') packageId: string,
    @Req() req: Request & { user?: { address?: string } },
  ): Promise<any> {
    try {
      const operatorAddress = req.user?.address || 'admin';
      return await this.aidEscrowService.disburseAidPackage(
        { packageId },
        operatorAddress,
      );
    } catch (error) {
      this.logger.error('Failed to disburse aid package:', error);
      this.errorMapper.throwMappedError(error);
    }
  }

  /**
   * Get aid package details
   * GET /onchain/aid-escrow/packages/:id
   */
  @Get('packages/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get aid package details',
    description:
      'Retrieves the full details of an aid package including status, amount, and expiration.',
  })
  @ApiOkResponse({
    description: 'Package details retrieved successfully.',
    schema: {
      example: {
        package: {
          id: 'pkg_123456789',
          recipient: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
          amount: '1000000000',
          token: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
          status: 'Created',
          createdAt: 1711814400,
          expiresAt: 1714406400,
          metadata: {
            campaign_ref: 'campaign-123',
          },
        },
        timestamp: '2026-03-30T12:30:00.000Z',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Package not found.' })
  @ApiInternalServerErrorResponse({
    description: 'Failed to retrieve package.',
  })
  async getAidPackage(@Param('id') packageId: string): Promise<any> {
    try {
      return await this.aidEscrowService.getAidPackage({ packageId });
    } catch (error) {
      this.logger.error('Failed to get aid package:', error);
      this.errorMapper.throwMappedError(error);
    }
  }

  /**
   * Get aid package aggregated statistics
   * GET /onchain/aid-escrow/stats
   */
  @Get('stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get aid package statistics',
    description:
      'Retrieves aggregated statistics for aid packages by token, including total committed, claimed, and expired amounts.',
  })
  @ApiOkResponse({
    description: 'Statistics retrieved successfully.',
    schema: {
      example: {
        aggregates: {
          totalCommitted: '5000000000',
          totalClaimed: '2000000000',
          totalExpiredCancelled: '500000000',
        },
        timestamp: '2026-03-30T12:30:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid token address.' })
  @ApiInternalServerErrorResponse({
    description: 'Failed to retrieve statistics.',
  })
  async getAidPackageStats(): Promise<any> {
    try {
      // For now, return aggregates for a default token
      // In production, this should be parameterized or determined from context
      const defaultTokenAddress =
        'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN';
      return await this.aidEscrowService.getAidPackageStats({
        tokenAddress: defaultTokenAddress,
      });
    } catch (error) {
      this.logger.error('Failed to get aid package stats:', error);
      this.errorMapper.throwMappedError(error);
    }
  }
}
