import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnchainAdapter, ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
import {
  CreateAidPackageDto,
  BatchCreateAidPackagesDto,
  ClaimAidPackageDto,
  DisburseAidPackageDto,
  GetAidPackageDto,
  GetAidPackageStatsDto,
  DryRunAidPackageResultDto,
  DryRunValidationErrorDto,
} from './dto/aid-escrow.dto';
import { BudgetService } from '../common/budget/budget.service';
import { GetTransactionStatusResult } from './onchain.adapter';
import { explorerTxUrl } from '../common/utils/explorer-url.util';

/**
 * AidEscrowService
 * Provides a high-level API for interacting with the Soroban AidEscrow contract
 * Handles all business logic for aid package operations with multi-token support
 */
@Injectable()
export class AidEscrowService {
  private readonly logger = new Logger(AidEscrowService.name);
  private readonly network: string;

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    private readonly budgetService: BudgetService,
    private readonly configService: ConfigService,
  ) {
    this.network = this.configService.get<string>('SOROBAN_NETWORK', 'testnet');
  }

  private withTxExplorerUrl<T extends { transactionHash?: string }>(
    result: T,
  ): T & { explorerUrl?: string } {
    if (!result.transactionHash) return result;
    return {
      ...result,
      explorerUrl: explorerTxUrl(result.transactionHash, this.network),
    };
  }

  private parsePositiveIntegerAmount(amount: string): {
    value?: bigint;
    error?: string;
  } {
    if (typeof amount !== 'string' || !/^\d+$/.test(amount)) {
      return { error: 'Amount must be a positive integer string' };
    }

    const value = BigInt(amount);
    if (value <= BigInt(0)) {
      return { error: 'Amount must be greater than zero' };
    }

    return { value };
  }

  private calculateFee(amount: bigint, feePercentage: string, maxFee: string) {
    const percentage = /^\d+$/.test(feePercentage)
      ? BigInt(feePercentage)
      : BigInt(0);
    const cap = /^\d+$/.test(maxFee) ? BigInt(maxFee) : BigInt(0);
    const uncappedFee = (amount * percentage) / BigInt(100);
    const estimatedFee =
      cap > BigInt(0) && uncappedFee > cap ? cap : uncappedFee;

    return {
      estimatedFee,
      totalEstimatedDebit: amount + estimatedFee,
    };
  }

  /**
   * Check token balance before creating packages
   * Ensures sufficient balance exists for the requested amount
   */
  async checkTokenBalance(
    tokenAddress: string,
    accountAddress: string,
    requiredAmount: string,
  ): Promise<{ sufficient: boolean; balance: string; required: string }> {
    this.logger.debug('Checking token balance:', {
      tokenAddress,
      accountAddress,
      requiredAmount,
    });

    const balanceResult = await this.onchainAdapter.getTokenBalance({
      tokenAddress,
      accountAddress,
    });

    const balance = BigInt(balanceResult.balance);
    const required = BigInt(requiredAmount);
    const sufficient = balance >= required;

    this.logger.debug('Balance check result:', {
      tokenAddress,
      balance: balanceResult.balance,
      required: requiredAmount,
      sufficient,
    });

    return {
      sufficient,
      balance: balanceResult.balance,
      required: requiredAmount,
    };
  }

  /**
   * Create a single aid package
   * Performs token balance check before creation
   */
  async createAidPackage(dto: CreateAidPackageDto, operatorAddress: string) {
    this.logger.debug('Creating aid package:', {
      packageId: dto.packageId,
      recipient: dto.recipientAddress,
      tokenAddress: dto.tokenAddress,
    });

    // Check token balance before creating package
    const balanceCheck = await this.checkTokenBalance(
      dto.tokenAddress,
      operatorAddress,
      dto.amount,
    );

    if (!balanceCheck.sufficient) {
      throw new BadRequestException(
        `Insufficient token balance for ${dto.tokenAddress}. ` +
          `Required: ${balanceCheck.required}, Available: ${balanceCheck.balance}`,
      );
    }

    // Enforce campaign funding cap if campaign_ref is present in metadata
    const campaignId = dto.metadata?.campaign_ref;
    if (campaignId) {
      const amountNum = Number(dto.amount);
      if (isNaN(amountNum)) {
        throw new BadRequestException('Invalid amount for funding cap check');
      }
      await this.budgetService.assertWithinBudget(campaignId, amountNum);
    }

    const result = await this.onchainAdapter.createAidPackage({
      operatorAddress,
      packageId: dto.packageId,
      recipientAddress: dto.recipientAddress,
      amount: dto.amount,
      tokenAddress: dto.tokenAddress,
      expiresAt: dto.expiresAt,
    });

    this.logger.debug('Aid package created successfully:', {
      packageId: result.packageId,
      transactionHash: result.transactionHash,
      tokenAddress: dto.tokenAddress,
    });

    return this.withTxExplorerUrl(result);
  }

  /**
   * Validate and simulate package issuance without submitting a transaction.
   */
  async dryRunAidPackageIssuance(
    dto: CreateAidPackageDto,
    operatorAddress: string,
  ): Promise<DryRunAidPackageResultDto> {
    this.logger.debug('Dry-running aid package issuance:', {
      packageId: dto.packageId,
      recipient: dto.recipientAddress,
      tokenAddress: dto.tokenAddress,
    });

    const validationErrors: DryRunValidationErrorDto[] = [];
    const addValidationError = (field: string, message: string) => {
      validationErrors.push({ field, message });
    };

    if (!dto.packageId || typeof dto.packageId !== 'string') {
      addValidationError('packageId', 'Package ID is required');
    }
    if (!dto.recipientAddress || typeof dto.recipientAddress !== 'string') {
      addValidationError('recipientAddress', 'Recipient address is required');
    }
    if (!dto.tokenAddress || typeof dto.tokenAddress !== 'string') {
      addValidationError('tokenAddress', 'Token address is required');
    }
    if (typeof dto.expiresAt !== 'number' || dto.expiresAt < 0) {
      addValidationError(
        'expiresAt',
        'Expiration must be a non-negative Unix timestamp',
      );
    }

    const amountParse = this.parsePositiveIntegerAmount(dto.amount);
    if (amountParse.error) {
      addValidationError('amount', amountParse.error);
    }

    const feeConfig = await this.onchainAdapter.getFeeConfig();
    const amount = amountParse.value ?? BigInt(0);
    const fees = this.calculateFee(
      amount,
      feeConfig.feePercentage,
      feeConfig.maxFee,
    );

    if (amountParse.value && dto.tokenAddress && operatorAddress) {
      try {
        const balanceCheck = await this.checkTokenBalance(
          dto.tokenAddress,
          operatorAddress,
          amountParse.value.toString(),
        );

        if (!balanceCheck.sufficient) {
          addValidationError(
            'balance',
            `Insufficient token balance for ${dto.tokenAddress}. Required: ${balanceCheck.required}, Available: ${balanceCheck.balance}`,
          );
        }
      } catch (error) {
        addValidationError(
          'balance',
          error instanceof Error
            ? error.message
            : 'Unable to validate token balance',
        );
      }
    }

    const campaignId = dto.metadata?.campaign_ref;
    if (campaignId && amountParse.value) {
      const amountNum = Number(dto.amount);
      if (Number.isNaN(amountNum)) {
        addValidationError('amount', 'Invalid amount for funding cap check');
      } else {
        try {
          await this.budgetService.assertWithinBudget(campaignId, amountNum);
        } catch (error) {
          addValidationError(
            'metadata.campaign_ref',
            error instanceof Error
              ? error.message
              : 'Campaign funding cap validation failed',
          );
        }
      }
    }

    return {
      valid: validationErrors.length === 0,
      status: 'dry_run',
      packageId: dto.packageId,
      fees: {
        feePercentage: feeConfig.feePercentage,
        maxFee: feeConfig.maxFee,
        estimatedFee: fees.estimatedFee.toString(),
        totalEstimatedDebit: fees.totalEstimatedDebit.toString(),
      },
      expectedEvents:
        validationErrors.length === 0
          ? [
              {
                topic: 'package_created',
                payload: {
                  package_id: dto.packageId,
                  recipient: dto.recipientAddress,
                  amount: dto.amount,
                  actor: operatorAddress,
                  timestamp: '<ledger close time>',
                },
              },
            ]
          : [],
      validationErrors,
      timestamp: new Date(),
      metadata: {
        operatorAddress,
        tokenAddress: dto.tokenAddress,
        stateChanges: false,
      },
    };
  }

  /**
   * Create multiple aid packages in a batch
   * Performs token balance check for total amount before creation
   */
  async batchCreateAidPackages(
    dto: BatchCreateAidPackagesDto,
    operatorAddress: string,
  ) {
    this.logger.debug('Batch creating aid packages:', {
      count: dto.recipientAddresses.length,
      tokenAddress: dto.tokenAddress,
    });

    if (dto.recipientAddresses.length !== dto.amounts.length) {
      throw new Error(
        'Recipients and amounts arrays must have the same length',
      );
    }

    // Calculate total amount required for all packages
    const totalAmount = dto.amounts.reduce(
      (sum, amount) => sum + BigInt(amount),
      BigInt(0),
    );

    // Check token balance for total amount
    const balanceCheck = await this.checkTokenBalance(
      dto.tokenAddress,
      operatorAddress,
      totalAmount.toString(),
    );

    if (!balanceCheck.sufficient) {
      throw new BadRequestException(
        `Insufficient token balance for batch creation. Token: ${dto.tokenAddress}, ` +
          `Required: ${balanceCheck.required}, Available: ${balanceCheck.balance}`,
      );
    }

    const result = await this.onchainAdapter.batchCreateAidPackages({
      operatorAddress,
      recipientAddresses: dto.recipientAddresses,
      amounts: dto.amounts,
      tokenAddress: dto.tokenAddress,
      expiresIn: dto.expiresIn,
    });

    this.logger.debug('Batch aid packages created successfully:', {
      packageCount: result.packageIds.length,
      transactionHash: result.transactionHash,
      tokenAddress: dto.tokenAddress,
    });

    return this.withTxExplorerUrl(result);
  }

  /**
   * Claim an aid package as recipient
   */
  async claimAidPackage(dto: ClaimAidPackageDto, recipientAddress: string) {
    this.logger.debug('Claiming aid package:', {
      packageId: dto.packageId,
      recipient: recipientAddress,
    });

    const result = await this.onchainAdapter.claimAidPackage({
      packageId: dto.packageId,
      recipientAddress,
    });

    this.logger.debug('Aid package claimed successfully:', {
      packageId: result.packageId,
      amountClaimed: result.amountClaimed,
    });

    return this.withTxExplorerUrl(result);
  }

  /**
   * Disburse an aid package (admin/operator action)
   */
  async disburseAidPackage(
    dto: DisburseAidPackageDto,
    operatorAddress: string,
  ) {
    this.logger.debug('Disbursing aid package:', {
      packageId: dto.packageId,
      operator: operatorAddress,
    });

    const result = await this.onchainAdapter.disburseAidPackage({
      packageId: dto.packageId,
      operatorAddress,
    });

    this.logger.debug('Aid package disbursed successfully:', {
      packageId: result.packageId,
      amountDisbursed: result.amountDisbursed,
    });

    return this.withTxExplorerUrl(result);
  }

  /**
   * Get details of an aid package
   */
  async getAidPackage(dto: GetAidPackageDto) {
    this.logger.debug('Retrieving aid package:', dto.packageId);

    const result = await this.onchainAdapter.getAidPackage({
      packageId: dto.packageId,
    });

    this.logger.debug('Aid package retrieved:', {
      packageId: result.package.id,
      status: result.package.status,
    });

    return result;
  }

  /**
   * Get aggregated statistics for aid packages
   */
  async getAidPackageStats(dto: GetAidPackageStatsDto) {
    this.logger.debug(
      'Retrieving aid package statistics for token:',
      dto.tokenAddress,
    );

    const result = await this.onchainAdapter.getAidPackageCount({
      token: dto.tokenAddress,
    });

    this.logger.debug('Aid package statistics retrieved:', {
      totalCommitted: result.aggregates.totalCommitted,
      totalClaimed: result.aggregates.totalClaimed,
    });

    return result;
  }

  /**
   * Get the status of a transaction by hash from Soroban RPC
   */
  async getTransactionStatus(
    hash: string,
  ): Promise<GetTransactionStatusResult & { explorerUrl?: string }> {
    this.logger.debug('Getting transaction status:', { hash });

    const result = await this.onchainAdapter.getTransactionStatus({ hash });

    this.logger.debug('Transaction status retrieved:', {
      hash: result.hash,
      status: result.status,
    });

    return { ...result, explorerUrl: explorerTxUrl(result.hash, this.network) };
  }
}
