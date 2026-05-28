import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
  GetContractMetadataResult,
  GetPauseStateResult,
  GetFeeConfigResult,
  GetPackageSummaryResult,
} from './onchain.adapter';
import {
  CreateAidPackageDto,
  BatchCreateAidPackagesDto,
  ClaimAidPackageDto,
  DisburseAidPackageDto,
  GetAidPackageDto,
  GetAidPackageStatsDto,
} from './dto/aid-escrow.dto';
import { BudgetService } from '../common/budget/budget.service';


/**
 * AidEscrowService
 * Provides a high-level API for interacting with the Soroban AidEscrow contract
 * Handles all business logic for aid package operations with multi-token support
 */
@Injectable()
export class AidEscrowService {
  private readonly logger = new Logger(AidEscrowService.name);

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    private readonly budgetService: BudgetService,
  ) {}

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

    return result;
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

    return result;
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

    return result;
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

    return result;
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

  // --- Read-only view methods ---

  /**
   * Returns contract metadata (admin address + current version).
   * Safe to expose publicly — no privileged data.
   */
  async getContractMetadata(): Promise<GetContractMetadataResult> {
    this.logger.debug('Retrieving contract metadata');
    const result = await this.onchainAdapter.getContractMetadata();
    this.logger.debug('Contract metadata retrieved:', {
      admin: result.admin,
      version: result.version,
    });
    return result;
  }

  /**
   * Returns global and per-action pause flags.
   * Frontend uses these to conditionally disable create/claim/withdraw UI.
   */
  async getPauseState(): Promise<GetPauseStateResult> {
    this.logger.debug('Retrieving contract pause state');
    const result = await this.onchainAdapter.getPauseState();
    this.logger.debug('Pause state retrieved:', {
      paused: result.paused,
      createPaused: result.createPaused,
      claimPaused: result.claimPaused,
      withdrawPaused: result.withdrawPaused,
    });
    return result;
  }

  /**
   * Returns fee/contract configuration (min amount, allowed tokens, max expiry).
   * Frontend uses minAmount to validate amounts before submission.
   */
  async getFeeConfig(): Promise<GetFeeConfigResult> {
    this.logger.debug('Retrieving contract fee config');
    const result = await this.onchainAdapter.getFeeConfig();
    this.logger.debug('Fee config retrieved:', {
      minAmount: result.minAmount,
      allowedTokensCount: result.allowedTokens.length,
    });
    return result;
  }

  /**
   * Returns package summary by ID, enriched with isExpired and ttlSeconds.
   * Frontend renders the claim UI accurately without a separate indexer call.
   */
  async getPackageSummary(packageId: string): Promise<GetPackageSummaryResult> {
    this.logger.debug('Retrieving package summary:', packageId);
    const result = await this.onchainAdapter.getPackageSummary({ packageId });
    this.logger.debug('Package summary retrieved:', {
      packageId: result.package.id,
      status: result.package.status,
      isExpired: result.isExpired,
      ttlSeconds: result.ttlSeconds,
    });
    return result;
  }
}
