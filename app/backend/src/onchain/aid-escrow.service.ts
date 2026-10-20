import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AppException, ERROR_CODES } from '../common/dto/error-response.dto';
import { ConfigService } from '@nestjs/config';
import { OnchainAdapter, ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
import {
  CreateAidPackageDto,
  BatchCreateAidPackagesDto,
  ClaimAidPackageDto,
  DisburseAidPackageDto,
  ExtendAidPackageExpiryDto,
  GetAidPackageDto,
  GetAidPackageStatsDto,
  DryRunAidPackageResultDto,
  DryRunValidationErrorDto,
  SetDelegateDto,
} from './dto/aid-escrow.dto';
import { BudgetService } from '../common/budget/budget.service';
import { AdminActionLogger } from '../audit/admin-action-logger.service';
import {
  GetTransactionStatusResult,
  SetDelegateResult,
  RevokeDelegateResult,
  GetDelegateResult,
  GetDelegateHistoryResult,
} from './onchain.adapter';
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
    private readonly adminActionLogger: AdminActionLogger,
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
  async createAidPackage(
    dto: CreateAidPackageDto,
    operatorAddress: string,
    actorId: string = operatorAddress,
    correlationId: string | null = null,
  ) {
    this.logger.debug('Creating aid package:', {
      packageId: dto.packageId,
      recipient: dto.recipientAddress,
      tokenAddress: dto.tokenAddress,
    });

    let transactionHash: string | null = null;
    const result = await this.adminActionLogger.execute(
      {
        actor: actorId,
        action: 'aid_package.create',
        target: { type: 'aid_package', id: dto.packageId },
        before: null,
        details: () => (transactionHash ? { transactionHash } : null),
        correlationId,
      },
      async () => {
        const balanceCheck = await this.checkTokenBalance(
          dto.tokenAddress,
          operatorAddress,
          dto.amount,
        );

        if (!balanceCheck.sufficient) {
          throw new AppException(
            ERROR_CODES.BAD_REQUEST,
            400,
            `Insufficient token balance for ${dto.tokenAddress}. ` +
              `Required: ${balanceCheck.required}, Available: ${balanceCheck.balance}`,
          );
        }

        const campaignId = dto.metadata?.campaign_ref;
        if (campaignId) {
          const amountNum = Number(dto.amount);
          if (isNaN(amountNum)) {
            throw new AppException(
              ERROR_CODES.BAD_REQUEST,
              400,
              'Invalid amount for funding cap check',
            );
          }
          await this.budgetService.assertWithinBudget(campaignId, amountNum);
        }

        const created = await this.onchainAdapter.createAidPackage({
          operatorAddress,
          packageId: dto.packageId,
          recipientAddress: dto.recipientAddress,
          amount: dto.amount,
          tokenAddress: dto.tokenAddress,
          expiresAt: dto.expiresAt,
        });
        transactionHash = created.transactionHash;
        return created;
      },
      async value => {
        if (value.status !== 'success') return null;
        const state = await this.onchainAdapter.getAidPackage({
          packageId: value.packageId,
        });
        return {
          packageId: state.package.id,
          status: state.package.status,
          amount: state.package.amount,
          token: state.package.token,
          expiresAt: state.package.expiresAt,
        };
      },
      value => value.status === 'success',
    );

    this.logger.debug(
      result.status === 'success'
        ? 'Aid package transaction confirmed'
        : 'Aid package transaction failed',
      {
        packageId: result.packageId,
        tokenAddress: dto.tokenAddress,
      },
    );

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
    actorId: string = operatorAddress,
    correlationId: string | null = null,
  ) {
    this.logger.debug('Batch creating aid packages:', {
      count: dto.recipientAddresses.length,
      tokenAddress: dto.tokenAddress,
    });

    let transactionHash: string | null = null;
    const result = await this.adminActionLogger.execute(
      {
        actor: actorId,
        action: 'aid_package.batch_create',
        target: { type: 'aid_package_batch', id: dto.tokenAddress },
        before: null,
        details: () => (transactionHash ? { transactionHash } : null),
        correlationId,
      },
      async () => {
        if (dto.recipientAddresses.length !== dto.amounts.length) {
          throw new AppException(
            ERROR_CODES.BAD_REQUEST,
            400,
            'Recipients and amounts arrays must have the same length',
          );
        }

        const totalAmount = dto.amounts.reduce(
          (sum, amount) => sum + BigInt(amount),
          BigInt(0),
        );
        const balanceCheck = await this.checkTokenBalance(
          dto.tokenAddress,
          operatorAddress,
          totalAmount.toString(),
        );

        if (!balanceCheck.sufficient) {
          throw new AppException(
            ERROR_CODES.BAD_REQUEST,
            400,
            `Insufficient token balance for batch creation. Token: ${dto.tokenAddress}, ` +
              `Required: ${balanceCheck.required}, Available: ${balanceCheck.balance}`,
          );
        }

        const created = await this.onchainAdapter.batchCreateAidPackages({
          operatorAddress,
          recipientAddresses: dto.recipientAddresses,
          amounts: dto.amounts,
          tokenAddress: dto.tokenAddress,
          expiresIn: dto.expiresIn,
        });
        transactionHash = created.transactionHash;
        return created;
      },
      async value => {
        if (value.status !== 'success') return null;
        const packages = await Promise.all(
          value.packageIds.map(async packageId => {
            const state = await this.onchainAdapter.getAidPackage({
              packageId,
            });
            return {
              packageId: state.package.id,
              status: state.package.status,
              amount: state.package.amount,
              token: state.package.token,
              expiresAt: state.package.expiresAt,
            };
          }),
        );
        return { packages };
      },
      value => value.status === 'success',
    );

    this.logger.debug(
      result.status === 'success'
        ? 'Batch aid package transaction confirmed'
        : 'Batch aid package transaction failed',
      {
        packageCount: result.packageIds.length,
        tokenAddress: dto.tokenAddress,
      },
    );

    return this.withTxExplorerUrl(result);
  }

  /**
   * Claim an aid package as recipient
   */
  async claimAidPackage(dto: ClaimAidPackageDto, recipientAddress: string) {
    this.logger.debug('Claiming aid package:', {
      packageId: dto.packageId,
      recipient: recipientAddress,
      amount: dto.amount,
    });

    const result = await this.onchainAdapter.claimAidPackage({
      packageId: dto.packageId,
      recipientAddress,
      amount: dto.amount,
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
    actorId: string = operatorAddress,
    correlationId: string | null = null,
  ) {
    this.logger.debug('Disbursing aid package:', {
      packageId: dto.packageId,
      operator: operatorAddress,
    });

    let before: { status: string; remainingAmount?: string } | null = null;
    let transactionHash: string | null = null;
    const result = await this.adminActionLogger.execute(
      {
        actor: actorId,
        action: 'aid_package.disburse',
        target: { type: 'aid_package', id: dto.packageId },
        before: () => before,
        details: () => (transactionHash ? { transactionHash } : null),
        correlationId,
      },
      async () => {
        const existing = await this.onchainAdapter.getAidPackage({
          packageId: dto.packageId,
        });
        before = {
          status: existing.package.status,
          remainingAmount: existing.package.remainingAmount,
        };
        const disbursed = await this.onchainAdapter.disburseAidPackage({
          packageId: dto.packageId,
          operatorAddress,
        });
        transactionHash = disbursed.transactionHash;
        return disbursed;
      },
      async value => {
        if (value.status !== 'success') return null;
        const state = await this.onchainAdapter.getAidPackage({
          packageId: dto.packageId,
        });
        return {
          status: state.package.status,
          remainingAmount: state.package.remainingAmount ?? null,
        };
      },
      value => value.status === 'success',
    );

    this.logger.debug(
      result.status === 'success'
        ? 'Aid package disbursement confirmed'
        : 'Aid package disbursement failed',
      { packageId: result.packageId },
    );

    return this.withTxExplorerUrl(result);
  }

  /**
   * Extend an aid package's expiration (operator/admin action).
   * Uses canonical absolute timestamp convention (extend_expiry).
   * Performs pre-checks, invokes onchain adapter, and records audit trail.
   */
  async extendAidPackageExpiry(
    dto: ExtendAidPackageExpiryDto & { packageId: string },
    operatorAddress: string,
    actorId: string = operatorAddress,
    correlationId: string | null = null,
  ) {
    this.logger.debug('Extending aid package expiry:', {
      packageId: dto.packageId,
      newExpiresAt: dto.newExpiresAt,
      operator: operatorAddress,
    });

    let oldExpiresAt: number | undefined;
    let transactionHash: string | null = null;
    const result = await this.adminActionLogger.execute(
      {
        actor: actorId,
        action: 'extend_expiry',
        target: { type: 'aid_package', id: dto.packageId },
        before: () =>
          oldExpiresAt === undefined ? null : { expiresAt: oldExpiresAt },
        details: () => (transactionHash ? { transactionHash } : null),
        correlationId,
      },
      async () => {
        try {
          const existing = await this.onchainAdapter.getAidPackage({
            packageId: dto.packageId,
          });
          if (existing?.package) {
            oldExpiresAt = existing.package.expiresAt;
            if (existing.package.status === 'Claimed') {
              throw new BadRequestException('Aid package is already claimed');
            }
            if (existing.package.status !== 'Created') {
              throw new BadRequestException(
                `Aid package is in status ${existing.package.status}`,
              );
            }
          }
        } catch (error) {
          if (error instanceof BadRequestException) throw error;
          // Continue and allow adapter/contract to validate.
        }

        const extended = await this.onchainAdapter.extendAidPackageExpiry({
          packageId: dto.packageId,
          newExpiresAt: dto.newExpiresAt,
          operatorAddress,
        });
        transactionHash = extended.transactionHash;
        return extended;
      },
      async value => {
        if (value.status !== 'success') return null;
        const state = await this.onchainAdapter.getAidPackage({
          packageId: dto.packageId,
        });
        return { expiresAt: state.package.expiresAt };
      },
      value => value.status === 'success',
    );

    const finalOldExpiresAt = result.oldExpiresAt ?? oldExpiresAt;

    return this.withTxExplorerUrl({
      ...result,
      oldExpiresAt: finalOldExpiresAt,
    });
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

  /**
   * Assign or update a delegate for a package (admin only).
   * If expiresAt is provided, the delegation is time-limited.
   */
  async setDelegate(
    packageId: string,
    dto: SetDelegateDto,
    adminAddress: string,
    actorId: string = adminAddress,
    correlationId: string | null = null,
  ): Promise<SetDelegateResult & { explorerUrl?: string }> {
    this.logger.debug('Setting delegate:', {
      packageId,
      delegate: dto.delegateAddress,
      expiresAt: dto.expiresAt,
      admin: adminAddress,
    });

    let before: GetDelegateResult | null = null;
    let transactionHash: string | null = null;
    const result = await this.adminActionLogger.execute(
      {
        actor: actorId,
        action: 'set_delegate',
        target: { type: 'aid_package', id: packageId },
        before: () =>
          before
            ? {
                delegateAddress: before.delegateAddress ?? null,
                expiresAt: before.expiresAt ?? null,
              }
            : null,
          details: () => (transactionHash ? { transactionHash } : null),
        correlationId,
      },
      async () => {
        before = await this.onchainAdapter.getDelegate({ packageId });
        const updated = await this.onchainAdapter.setDelegate({
          adminAddress,
          packageId,
          delegateAddress: dto.delegateAddress,
          expiresAt: dto.expiresAt,
        });
        transactionHash = updated.transactionHash;
        return updated;
      },
      async value => {
        if (value.status !== 'success') return null;
        const state = await this.onchainAdapter.getDelegate({ packageId });
        return {
          delegateAddress: state.delegateAddress ?? null,
          expiresAt: state.expiresAt ?? null,
        };
      },
      value => value.status === 'success',
    );

    return this.withTxExplorerUrl(result);
  }

  /**
   * Revoke the current delegate for a package (admin only).
   */
  async revokeDelegate(
    packageId: string,
    adminAddress: string,
    actorId: string = adminAddress,
    correlationId: string | null = null,
  ): Promise<RevokeDelegateResult & { explorerUrl?: string }> {
    this.logger.debug('Revoking delegate:', { packageId, admin: adminAddress });

    let before: GetDelegateResult | null = null;
  let transactionHash: string | null = null;
    const result = await this.adminActionLogger.execute(
      {
        actor: actorId,
        action: 'revoke_delegate',
        target: { type: 'aid_package', id: packageId },
        before: () =>
          before
            ? {
                delegateAddress: before.delegateAddress ?? null,
                expiresAt: before.expiresAt ?? null,
              }
            : null,
          details: () => (transactionHash ? { transactionHash } : null),
        correlationId,
      },
      async () => {
        before = await this.onchainAdapter.getDelegate({ packageId });
        const revoked = await this.onchainAdapter.revokeDelegate({
          adminAddress,
          packageId,
        });
        transactionHash = revoked.transactionHash;
        return revoked;
      },
      async value => {
        if (value.status !== 'success') return null;
        const state = await this.onchainAdapter.getDelegate({ packageId });
        return {
          delegateAddress: state.delegateAddress ?? null,
          expiresAt: state.expiresAt ?? null,
        };
      },
      value => value.status === 'success',
    );

    return this.withTxExplorerUrl(result);
  }

  /**
   * Get the current active delegate for a package.
   */
  async getDelegate(packageId: string): Promise<GetDelegateResult> {
    this.logger.debug('Getting delegate:', { packageId });
    return this.onchainAdapter.getDelegate({ packageId });
  }

  /**
   * Get the full delegate change history for a package.
   */
  async getDelegateHistory(
    packageId: string,
  ): Promise<GetDelegateHistoryResult> {
    this.logger.debug('Getting delegate history:', { packageId });
    return this.onchainAdapter.getDelegateHistory({ packageId });
  }
}
