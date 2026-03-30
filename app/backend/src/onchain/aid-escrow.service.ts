import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { OnchainAdapter, ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
import {
  CreateAidPackageDto,
  BatchCreateAidPackagesDto,
  ClaimAidPackageDto,
  DisburseAidPackageDto,
  GetAidPackageDto,
  GetAidPackageStatsDto,
} from './dto/aid-escrow.dto';

/**
 * AidEscrowService
 * Provides a high-level API for interacting with the Soroban AidEscrow contract
 * Handles all business logic for aid package operations
 */
@Injectable()
export class AidEscrowService {
  private readonly logger = new Logger(AidEscrowService.name);

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
  ) {}

  /**
   * Create a single aid package
   */
  async createAidPackage(dto: CreateAidPackageDto, operatorAddress: string) {
    this.logger.debug('Creating aid package:', {
      packageId: dto.packageId,
      recipient: dto.recipientAddress,
    });

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
    });

    return result;
  }

  /**
   * Create multiple aid packages in a batch
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
}
