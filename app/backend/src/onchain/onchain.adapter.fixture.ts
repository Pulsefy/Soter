import { Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import {
  OnchainAdapter,
  InitEscrowParams,
  InitEscrowResult,
  CreateClaimParams,
  CreateClaimResult,
  DisburseParams,
  DisburseResult,
  CreateAidPackageParams,
  CreateAidPackageResult,
  BatchCreateAidPackagesParams,
  BatchCreateAidPackagesResult,
  ClaimAidPackageParams,
  ClaimAidPackageResult,
  DisburseAidPackageParams,
  DisburseAidPackageResult,
  GetAidPackageParams,
  GetAidPackageResult,
  GetAidPackageCountParams,
  GetAidPackageCountResult,
  GetTokenBalanceParams,
  GetTokenBalanceResult,
  ContractMetadata,
  PauseState,
  FeeConfig,
  PackageSummary,
  GetTransactionStatusParams,
  GetTransactionStatusResult,
  TxStatus,
} from './onchain.adapter';

/**
 * FixtureOnchainAdapter reads golden JSON fixtures to provide deterministic
 * responses for CI testing. It avoids Date.now() or randomness entirely.
 */
@Injectable()
export class FixtureOnchainAdapter implements OnchainAdapter {
  private getFixturePath(filename: string): string {
    return path.join(__dirname, 'fixtures', filename);
  }

  private loadFixture<T>(filename: string, key = 'default'): T {
    const fullPath = this.getFixturePath(filename);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(content);
    
    if (!(key in parsed)) {
      throw new Error(`Fixture key '${key}' not found in ${filename}`);
    }
    
    // Add real JS Date objects where they were encoded as ISO strings
    return this.parseDates(parsed[key]) as T;
  }

  private parseDates(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.parseDates(item));
    }
    
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'timestamp' && typeof value === 'string') {
        result[key] = new Date(value);
      } else {
        result[key] = this.parseDates(value);
      }
    }
    
    return result;
  }

  async initEscrow(params: InitEscrowParams): Promise<InitEscrowResult> {
    const fixture = this.loadFixture<InitEscrowResult>('initEscrow.fixture.json');
    return {
      ...fixture,
      metadata: {
        ...fixture.metadata,
        adminAddress: params.adminAddress
      }
    };
  }

  async createAidPackage(params: CreateAidPackageParams): Promise<CreateAidPackageResult> {
    const fixture = this.loadFixture<CreateAidPackageResult>('createAidPackage.fixture.json');
    return {
      ...fixture,
      packageId: params.packageId,
      metadata: {
        ...fixture.metadata,
        packageId: params.packageId,
        operatorAddress: params.operatorAddress,
        recipientAddress: params.recipientAddress,
        amount: params.amount,
        tokenAddress: params.tokenAddress,
        expiresAt: params.expiresAt
      }
    };
  }

  async batchCreateAidPackages(params: BatchCreateAidPackagesParams): Promise<BatchCreateAidPackagesResult> {
    const fixture = this.loadFixture<BatchCreateAidPackagesResult>('batchCreateAidPackages.fixture.json');
    const packageIds = params.recipientAddresses.map((_, index) => `${index}`);
    return {
      ...fixture,
      packageIds,
      metadata: {
        ...fixture.metadata,
        operatorAddress: params.operatorAddress,
        count: params.recipientAddresses.length,
        tokenAddress: params.tokenAddress
      }
    };
  }

  async claimAidPackage(params: ClaimAidPackageParams): Promise<ClaimAidPackageResult> {
    const fixture = this.loadFixture<ClaimAidPackageResult>('claimAidPackage.fixture.json');
    return {
      ...fixture,
      packageId: params.packageId,
      metadata: {
        ...fixture.metadata,
        packageId: params.packageId,
        recipientAddress: params.recipientAddress
      }
    };
  }

  async disburseAidPackage(params: DisburseAidPackageParams): Promise<DisburseAidPackageResult> {
    const fixture = this.loadFixture<DisburseAidPackageResult>('disburseAidPackage.fixture.json');
    return {
      ...fixture,
      packageId: params.packageId,
      metadata: {
        ...fixture.metadata,
        packageId: params.packageId,
        operatorAddress: params.operatorAddress
      }
    };
  }

  async getAidPackage(params: GetAidPackageParams): Promise<GetAidPackageResult> {
    const fixture = this.loadFixture<GetAidPackageResult>('getAidPackage.fixture.json');
    return {
      ...fixture,
      package: {
        ...fixture.package,
        id: params.packageId
      }
    };
  }

  async getAidPackageCount(_params: GetAidPackageCountParams): Promise<GetAidPackageCountResult> {
    return this.loadFixture<GetAidPackageCountResult>('getAidPackageCount.fixture.json');
  }

  async getTokenBalance(params: GetTokenBalanceParams): Promise<GetTokenBalanceResult> {
    const fixture = this.loadFixture<GetTokenBalanceResult>('getTokenBalance.fixture.json');
    return {
      ...fixture,
      tokenAddress: params.tokenAddress,
      accountAddress: params.accountAddress
    };
  }

  async getContractMetadata(): Promise<ContractMetadata> {
    return this.loadFixture<ContractMetadata>('getContractMetadata.fixture.json');
  }

  async getPauseState(): Promise<PauseState> {
    return this.loadFixture<PauseState>('getPauseState.fixture.json');
  }

  async getFeeConfig(): Promise<FeeConfig> {
    return this.loadFixture<FeeConfig>('getFeeConfig.fixture.json');
  }

  async getPackageSummary(packageId: string): Promise<PackageSummary> {
    const fixture = this.loadFixture<PackageSummary>('getPackageSummary.fixture.json');
    return {
      ...fixture,
      packageId
    };
  }

  async getTransactionStatus(params: GetTransactionStatusParams): Promise<GetTransactionStatusResult> {
    const hash = params.hash.toUpperCase();
    const firstChar = hash.charAt(0);
    
    let key = 'unknown';
    if (firstChar >= '0' && firstChar <= '7') {
      key = 'succeeded';
    } else if (firstChar >= '8' && firstChar <= 'B') {
      key = 'pending';
    } else if (firstChar >= 'C' && firstChar <= 'D') {
      key = 'failed';
    }

    const fixture = this.loadFixture<GetTransactionStatusResult>('getTransactionStatus.fixture.json', key);
    
    return {
      ...fixture,
      hash
    };
  }

  async createClaim(params: CreateClaimParams): Promise<CreateClaimResult> {
    const fixture = this.loadFixture<CreateClaimResult>('createClaim.fixture.json');
    return {
      ...fixture,
      packageId: params.claimId, // In mocks we mirror it over to fake the logic
      metadata: {
        ...fixture.metadata,
        claimId: params.claimId,
        recipientAddress: params.recipientAddress,
        amount: params.amount,
        tokenAddress: params.tokenAddress,
        expiresAt: params.expiresAt
      }
    };
  }

  async disburse(params: DisburseParams): Promise<DisburseResult> {
    const fixture = this.loadFixture<DisburseResult>('disburse.fixture.json');
    return {
      ...fixture,
      amountDisbursed: params.amount || fixture.amountDisbursed,
      metadata: {
        ...fixture.metadata,
        claimId: params.claimId,
        packageId: params.packageId,
        recipientAddress: params.recipientAddress
      }
    };
  }
}
