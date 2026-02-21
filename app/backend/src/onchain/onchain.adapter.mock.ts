import { Injectable } from '@nestjs/common';
import {
  OnchainAdapter,
  InitEscrowParams,
  InitEscrowResult,
  CreateClaimParams,
  CreateClaimResult,
  DisburseParams,
  DisburseResult,
} from './onchain.adapter';
import { createHash } from 'crypto';

/**
 * Mock implementation of OnchainAdapter for development and testing
 * Returns deterministic responses based on input parameters
 */
@Injectable()
export class MockOnchainAdapter implements OnchainAdapter {
  private readonly mockEscrowAddress =
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  /**
   * Generate a deterministic mock transaction hash from input
   */
  private generateMockHash(input: string): string {
    const hash = createHash('sha256').update(input).digest('hex');
    // Format as Stellar/Soroban transaction hash (64 hex chars)
    return hash.substring(0, 64).toUpperCase();
  }

  /**
   * Generate a deterministic package ID from claim ID
   */
  private generatePackageId(claimId: string): string {
    const hash = createHash('sha256')
      .update(`package-${claimId}`)
      .digest('hex');
    // Convert first 16 hex chars to decimal for package ID
    return BigInt('0x' + hash.substring(0, 16)).toString();
  }

  async initEscrow(params: InitEscrowParams): Promise<InitEscrowResult> {
    await Promise.resolve();
    const transactionHash = this.generateMockHash(
      `init-${params.adminAddress}-${Date.now()}`,
    );

    return {
      escrowAddress: this.mockEscrowAddress,
      transactionHash,
      timestamp: new Date(),
      status: 'success',
      metadata: {
        adminAddress: params.adminAddress,
        adapter: 'mock',
      },
    };
  }

  async createClaim(params: CreateClaimParams): Promise<CreateClaimResult> {
    await Promise.resolve();
    const packageId = this.generatePackageId(params.claimId);
    const transactionHash = this.generateMockHash(
      `create-${params.claimId}-${packageId}-${Date.now()}`,
    );

    return {
      packageId,
      transactionHash,
      timestamp: new Date(),
      status: 'success',
      metadata: {
        claimId: params.claimId,
        recipientAddress: params.recipientAddress,
        amount: params.amount,
        tokenAddress: params.tokenAddress,
        expiresAt: params.expiresAt,
        adapter: 'mock',
      },
    };
  }

  async disburse(params: DisburseParams): Promise<DisburseResult> {
    await Promise.resolve();
    const transactionHash = this.generateMockHash(
      `disburse-${params.claimId}-${params.packageId}-${Date.now()}`,
    );

    // Use provided amount or default to a mock value
    const amountDisbursed = params.amount || '1000000000'; // 1000.0000000 in stroops

    return {
      transactionHash,
      timestamp: new Date(),
      status: 'success',
      amountDisbursed,
      metadata: {
        claimId: params.claimId,
        packageId: params.packageId,
        recipientAddress: params.recipientAddress,
        adapter: 'mock',
      },
    };
  }
}
