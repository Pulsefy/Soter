import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  rpc as SorobanRpc,
  Contract,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  Keypair,
  BASE_FEE,
  xdr,
} from '@stellar/stellar-sdk';
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
  AidPackage,
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
import { SorobanErrorMapper } from './utils/soroban-error.mapper';
import { withRetryTimeout } from './utils/retry-with-timeout';

@Injectable()
export class SorobanAdapter implements OnchainAdapter {
  private readonly logger = new Logger(SorobanAdapter.name);
  private readonly contractId: string;
  private readonly rpcUrl: string;
  private readonly networkPassphrase: string;
  private readonly network: string;
  private readonly adminSecretKey: string;
  private readonly errorMapper: SorobanErrorMapper;
  private server: SorobanRpc.Server | null = null;
  private keypair: Keypair | null = null;

  constructor(private configService: ConfigService) {
    this.contractId = this.configService.get<string>(
      'AID_ESCROW_CONTRACT_ID',
      '',
    );
    this.network = this.configService.get<string>('SOROBAN_NETWORK', 'testnet');
    this.rpcUrl = this.configService.get<string>(
      'STELLAR_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
    this.networkPassphrase = this.configService.get<string>(
      'STELLAR_NETWORK_PASSPHRASE',
      'Test SDF Network ; September 2015',
    );
    this.adminSecretKey = this.configService.get<string>(
      'SOROBAN_ADMIN_SECRET_KEY',
      '',
    );
    this.errorMapper = new SorobanErrorMapper();
  }

  private validateConfig(): void {
    if (
      !this.contractId ||
      !this.contractId.startsWith('C') ||
      this.contractId.length !== 56
    ) {
      throw new Error(
        'AID_ESCROW_CONTRACT_ID is missing or invalid. Must be a 56-char Soroban contract ID starting with "C".',
      );
    }
    if (!this.adminSecretKey) {
      throw new Error(
        'SOROBAN_ADMIN_SECRET_KEY is not configured. Required for signing Soroban transactions.',
      );
    }
    if (!this.rpcUrl.includes('testnet')) {
      throw new Error(
        `Cross-network mismatch: STELLAR_RPC_URL (${this.rpcUrl}) does not appear to be testnet.`,
      );
    }
    if (!this.networkPassphrase.includes('Test SDF Network')) {
      throw new Error(
        'Cross-network mismatch: STELLAR_NETWORK_PASSPHRASE does not match testnet passphrase.',
      );
    }
  }

  private getServer(): SorobanRpc.Server {
    if (!this.server) {
      this.server = new SorobanRpc.Server(this.rpcUrl, {
        allowHttp: this.rpcUrl.startsWith('http://'),
      });
    }
    return this.server;
  }

  private getKeypair(): Keypair {
    if (!this.keypair) {
      this.keypair = Keypair.fromSecret(this.adminSecretKey);
    }
    return this.keypair;
  }

  private ensureConfigured(): void {
    if (!this.contractId) {
      throw new Error('AID_ESCROW_CONTRACT_ID not configured.');
    }
    this.validateConfig();
  }

  private correlationId(): string {
    return `testnet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private async submitContractOp(
    method: string,
    args: xdr.ScVal[],
    correlationId: string,
  ): Promise<{ hash: string; result: any }> {
    const server = this.getServer();
    const kp = this.getKeypair();
    const contract = new Contract(this.contractId);
    const pubKey = kp.publicKey();

    const account = await withRetryTimeout(
      () => server.getAccount(pubKey),
      `getAccount(${pubKey})`,
      correlationId,
      {},
      this.logger,
    );

    const operation = contract.call(method, ...args);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const simulation = await withRetryTimeout(
      () => server.simulateTransaction(tx),
      `simulateTransaction(${method})`,
      correlationId,
      {},
      this.logger,
    );

    if (SorobanRpc.Api.isSimulationError(simulation)) {
      const errorMsg =
        simulation.error ?? 'Simulation failed with no error message';
      this.logger.error(
        `[${correlationId}] Simulation error for ${method}: ${errorMsg}`,
      );
      throw new Error(`Contract simulation error: ${errorMsg}`);
    }

    const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
    preparedTx.sign(kp);

    const sendResult = await withRetryTimeout(
      () => server.sendTransaction(preparedTx),
      `sendTransaction(${method})`,
      correlationId,
      {},
      this.logger,
    );

    if (sendResult.status === 'PENDING' || sendResult.status === 'DUPLICATE') {
      const hash = sendResult.hash.toUpperCase();
      const receipt = await withRetryTimeout(
        async () => {
          const getResult = await server.getTransaction(hash);
          if (
            getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND
          ) {
            throw new Error('Transaction not yet confirmed');
          }
          return getResult;
        },
        `pollTransaction(${method})`,
        correlationId,
        {
          maxRetries: 10,
          baseDelayMs: 2000,
          maxDelayMs: 30000,
          operationTimeoutMs: 120000,
        },
        this.logger,
      );

      if (receipt.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        const contractErr = this.extractContractError(receipt);
        throw new Error(contractErr);
      }

      const retval: unknown = receipt.returnValue
        ? scValToNative(receipt.returnValue)
        : null;

      return { hash, result: retval };
    }

    throw new Error(
      `Transaction submission failed with status: ${sendResult.status}`,
    );
  }

  private async simulateReadOnly(
    method: string,
    args: xdr.ScVal[],
    correlationId: string,
  ): Promise<unknown> {
    const server = this.getServer();
    const kp = this.getKeypair();
    const contract = new Contract(this.contractId);
    const pubKey = kp.publicKey();

    const account = await withRetryTimeout(
      () => server.getAccount(pubKey),
      `getAccount(${pubKey})`,
      correlationId,
      {},
      this.logger,
    );

    const operation = contract.call(method, ...args);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const simulation = await withRetryTimeout(
      () => server.simulateTransaction(tx),
      `simulateReadOnly(${method})`,
      correlationId,
      {},
      this.logger,
    );

    if (SorobanRpc.Api.isSimulationError(simulation)) {
      const errorMsg = simulation.error ?? 'Simulation failed';
      throw new Error(`Contract simulation error: ${errorMsg}`);
    }

    if (SorobanRpc.Api.isSimulationSuccess(simulation)) {
      if (simulation.result?.retval) {
        return scValToNative(simulation.result.retval) as unknown;
      }
    }

    return null;
  }

  private extractContractError(receipt: any): string {
    if (receipt?.result?.retval) {
      try {
        const val: unknown = scValToNative(receipt.result.retval);
        if (typeof val === 'object' && val !== null) {
          return JSON.stringify(val);
        }
        return String(val);
      } catch {
        // fall through
      }
    }
    return 'Contract transaction failed';
  }

  private scvAddress(address: string): xdr.ScVal {
    return nativeToScVal(address, { type: 'address' });
  }

  private scvI128(amount: string | number): xdr.ScVal {
    return nativeToScVal(amount.toString(), { type: 'i128' });
  }

  private scvU64(value: number | bigint): xdr.ScVal {
    return nativeToScVal(Number(value), { type: 'u64' });
  }

  private scvU32(value: number): xdr.ScVal {
    return nativeToScVal(value, { type: 'u32' });
  }

  private scvSymbol(value: string): xdr.ScVal {
    return nativeToScVal(value, { type: 'symbol' });
  }

  private scvString(value: string): xdr.ScVal {
    return nativeToScVal(value, { type: 'string' });
  }

  private scvVec(items: xdr.ScVal[]): xdr.ScVal {
    return nativeToScVal(items, { type: 'vec' });
  }

  private scvMap(entries: Record<string, string>): xdr.ScVal {
    const mapVal: { key: xdr.ScVal; value: xdr.ScVal }[] = [];
    for (const [k, v] of Object.entries(entries)) {
      mapVal.push({
        key: this.scvSymbol(k),
        value: this.scvString(v),
      });
    }
    return nativeToScVal(mapVal, { type: 'map' });
  }

  private parsePackage(scv: unknown): AidPackage | null {
    if (!scv || typeof scv !== 'object') return null;
    const data = scv as {
      id?: string | number;
      recipient?: string;
      amount?: string | number;
      token?: string;
      status?: number | string;
      created_at?: number;
      expires_at?: number;
      metadata?: Record<string, string>;
    };
    return {
      id: String(data.id ?? ''),
      recipient: String(data.recipient ?? ''),
      amount: String(data.amount ?? '0'),
      token: String(data.token ?? ''),
      status: this.parseStatus(data.status),
      createdAt: Number(data.created_at ?? 0),
      expiresAt: Number(data.expires_at ?? 0),
      metadata: data.metadata,
    };
  }

  private parseStatus(status: unknown): AidPackage['status'] {
    if (typeof status === 'number') {
      const map: Record<number, AidPackage['status']> = {
        0: 'Created',
        1: 'Claimed',
        2: 'Expired',
        3: 'Cancelled',
        4: 'Refunded',
      };
      return map[status] ?? 'Created';
    }
    if (typeof status === 'string') {
      if (
        ['Created', 'Claimed', 'Expired', 'Cancelled', 'Refunded'].includes(
          status,
        )
      ) {
        return status as AidPackage['status'];
      }
    }
    return 'Created';
  }

  async initEscrow(params: InitEscrowParams): Promise<InitEscrowResult> {
    this.ensureConfigured();
    const cid = this.correlationId();
    this.logger.log(`[${cid}] initEscrow admin=${params.adminAddress}`);

    const { hash } = await this.submitContractOp(
      'init',
      [this.scvAddress(params.adminAddress)],
      cid,
    );

    return {
      escrowAddress: this.contractId,
      transactionHash: hash,
      timestamp: new Date(),
      status: 'success',
      metadata: { contractId: this.contractId },
    };
  }

  async createAidPackage(
    params: CreateAidPackageParams,
  ): Promise<CreateAidPackageResult> {
    this.ensureConfigured();
    const cid = this.correlationId();
    this.logger.log(`[${cid}] createAidPackage id=${params.packageId}`);

    const metadata = params.metadata ?? {};
    const metadataScv = this.scvMap(metadata);

    const { hash, result } = await this.submitContractOp(
      'create_package',
      [
        this.scvAddress(params.operatorAddress),
        this.scvU64(parseInt(params.packageId, 10)),
        this.scvAddress(params.recipientAddress),
        this.scvI128(params.amount),
        this.scvAddress(params.tokenAddress),
        this.scvU64(params.expiresAt),
        metadataScv,
      ],
      cid,
    );

    return {
      packageId: String(result ?? params.packageId),
      transactionHash: hash,
      timestamp: new Date(),
      status: 'success',
      metadata: {
        contractId: this.contractId,
        operator: params.operatorAddress,
      },
    };
  }

  async batchCreateAidPackages(
    params: BatchCreateAidPackagesParams,
  ): Promise<BatchCreateAidPackagesResult> {
    this.ensureConfigured();
    const cid = this.correlationId();
    this.logger.log(
      `[${cid}] batchCreateAidPackages count=${params.recipientAddresses.length}`,
    );

    const recipientsScv = this.scvVec(
      params.recipientAddresses.map(r => this.scvAddress(r)),
    );
    const amountsScv = this.scvVec(params.amounts.map(a => this.scvI128(a)));

    const emptyMetadatas = params.recipientAddresses.map(() => ({}));
    const metadatasScv = this.scvVec(emptyMetadatas.map(m => this.scvMap(m)));

    const { hash, result } = await this.submitContractOp(
      'batch_create_packages',
      [
        this.scvAddress(params.operatorAddress),
        recipientsScv,
        amountsScv,
        this.scvAddress(params.tokenAddress),
        this.scvU64(params.expiresIn),
        metadatasScv,
      ],
      cid,
    );

    const ids: string[] = [];
    if (Array.isArray(result)) {
      for (const id of result) {
        ids.push(String(id));
      }
    }

    return {
      packageIds: ids,
      transactionHash: hash,
      timestamp: new Date(),
      status: 'success',
      metadata: { contractId: this.contractId, count: ids.length },
    };
  }

  async claimAidPackage(
    params: ClaimAidPackageParams,
  ): Promise<ClaimAidPackageResult> {
    this.ensureConfigured();
    const cid = this.correlationId();
    this.logger.log(`[${cid}] claimAidPackage id=${params.packageId}`);

    const { hash } = await this.submitContractOp(
      'claim',
      [this.scvU64(parseInt(params.packageId, 10))],
      cid,
    );

    return {
      packageId: params.packageId,
      transactionHash: hash,
      timestamp: new Date(),
      status: 'success',
      amountClaimed: '',
      metadata: {
        contractId: this.contractId,
        recipient: params.recipientAddress,
      },
    };
  }

  async disburseAidPackage(
    params: DisburseAidPackageParams,
  ): Promise<DisburseAidPackageResult> {
    this.ensureConfigured();
    const cid = this.correlationId();
    this.logger.log(`[${cid}] disburseAidPackage id=${params.packageId}`);

    const { hash } = await this.submitContractOp(
      'disburse',
      [this.scvU64(parseInt(params.packageId, 10))],
      cid,
    );

    return {
      packageId: params.packageId,
      transactionHash: hash,
      timestamp: new Date(),
      status: 'success',
      amountDisbursed: '',
      metadata: {
        contractId: this.contractId,
        operator: params.operatorAddress,
      },
    };
  }

  async getAidPackage(
    params: GetAidPackageParams,
  ): Promise<GetAidPackageResult> {
    this.ensureConfigured();
    const cid = this.correlationId();
    this.logger.log(`[${cid}] getAidPackage id=${params.packageId}`);

    const result = await this.simulateReadOnly(
      'get_package',
      [this.scvU64(parseInt(params.packageId, 10))],
      cid,
    );

    const pkg = this.parsePackage(result);

    return {
      package: pkg ?? {
        id: params.packageId,
        recipient: '',
        amount: '0',
        token: '',
        status: 'Created',
        createdAt: 0,
        expiresAt: 0,
      },
      timestamp: new Date(),
    };
  }

  async getAidPackageCount(
    params: GetAidPackageCountParams,
  ): Promise<GetAidPackageCountResult> {
    this.ensureConfigured();
    const cid = this.correlationId();
    this.logger.log(`[${cid}] getAidPackageCount token=${params.token}`);

    const result = await this.simulateReadOnly(
      'get_aggregates',
      [this.scvAddress(params.token)],
      cid,
    );

    const data =
      (result as {
        total_committed?: string | number;
        total_claimed?: string | number;
        total_expired_cancelled?: string | number;
      }) || {};
    return {
      aggregates: {
        totalCommitted: String(data.total_committed ?? '0'),
        totalClaimed: String(data.total_claimed ?? '0'),
        totalExpiredCancelled: String(data.total_expired_cancelled ?? '0'),
      },
      timestamp: new Date(),
    };
  }

  async getTokenBalance(
    params: GetTokenBalanceParams,
  ): Promise<GetTokenBalanceResult> {
    this.ensureConfigured();
    const cid = this.correlationId();
    this.logger.log(`[${cid}] getTokenBalance token=${params.tokenAddress}`);

    const server = this.getServer();
    const kp = this.getKeypair();
    const contract = new Contract(params.tokenAddress);
    const pubKey = kp.publicKey();

    const account = await server.getAccount(pubKey);
    const operation = contract.call(
      'balance',
      this.scvAddress(params.accountAddress),
    );
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const simulation = await server.simulateTransaction(tx);
    let balance = '0';
    if (
      SorobanRpc.Api.isSimulationSuccess(simulation) &&
      simulation.result?.retval
    ) {
      balance = String(scValToNative(simulation.result.retval));
    }

    return {
      tokenAddress: params.tokenAddress,
      accountAddress: params.accountAddress,
      balance,
      timestamp: new Date(),
    };
  }

  async getContractMetadata(): Promise<ContractMetadata> {
    this.ensureConfigured();
    const cid = this.correlationId();
    this.logger.log(`[${cid}] getContractMetadata`);

    const version = await this.simulateReadOnly('get_version', [], cid);

    return {
      version: String((version as string | number) ?? '0'),
      name: 'Soroban AidEscrow Contract',
      timestamp: new Date(),
    };
  }

  async getPauseState(): Promise<PauseState> {
    this.ensureConfigured();
    const cid = this.correlationId();
    this.logger.log(`[${cid}] getPauseState`);

    const result = await this.simulateReadOnly('is_paused', [], cid);

    return {
      isPaused: result === true,
      timestamp: new Date(),
    };
  }

  getFeeConfig(): Promise<FeeConfig> {
    return Promise.resolve({
      feePercentage: '0',
      maxFee: '0',
      timestamp: new Date(),
    });
  }

  async getPackageSummary(packageId: string): Promise<PackageSummary> {
    const pkg = await this.getAidPackage({ packageId });
    return {
      packageId,
      totalAmount: pkg.package.amount,
      claimedAmount:
        pkg.package.status === 'Claimed' ? pkg.package.amount : '0',
      status: pkg.package.status,
      timestamp: new Date(),
    };
  }

  async getTransactionStatus(
    params: GetTransactionStatusParams,
  ): Promise<GetTransactionStatusResult> {
    this.ensureConfigured();
    const cid = this.correlationId();
    const hash = params.hash.toUpperCase();
    this.logger.log(`[${cid}] getTransactionStatus hash=${hash}`);

    const server = this.getServer();

    try {
      const result = await withRetryTimeout(
        () => server.getTransaction(hash),
        `getTransaction(${hash})`,
        cid,
        { maxRetries: 0, operationTimeoutMs: 30000 },
        this.logger,
      );

      let status: TxStatus;
      switch (result.status) {
        case SorobanRpc.Api.GetTransactionStatus.SUCCESS:
          status = 'succeeded';
          break;
        case SorobanRpc.Api.GetTransactionStatus.FAILED:
          status = 'failed';
          break;
        case SorobanRpc.Api.GetTransactionStatus.NOT_FOUND:
          status = 'pending';
          break;
        default:
          status = 'unknown';
      }

      return {
        hash,
        status,
        timestamp: new Date(),
        ledger:
          'ledger' in result && typeof result.ledger === 'number'
            ? result.ledger
            : undefined,
        errorMessage:
          status === 'failed' ? this.extractContractError(result) : undefined,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('timed out')) {
        return { hash, status: 'unknown', timestamp: new Date() };
      }
      throw error;
    }
  }

  async createClaim(params: CreateClaimParams): Promise<CreateClaimResult> {
    const result = await this.createAidPackage({
      operatorAddress: '',
      packageId: params.claimId,
      recipientAddress: params.recipientAddress,
      amount: params.amount,
      tokenAddress: params.tokenAddress,
      expiresAt: params.expiresAt ?? Math.floor(Date.now() / 1000) + 86400 * 30,
    });
    return {
      packageId: result.packageId,
      transactionHash: result.transactionHash,
      timestamp: result.timestamp,
      status: result.status,
      metadata: result.metadata,
    };
  }

  async disburse(params: DisburseParams): Promise<DisburseResult> {
    const result = await this.disburseAidPackage({
      packageId: params.packageId,
      operatorAddress: params.recipientAddress ?? '',
    });
    return {
      transactionHash: result.transactionHash,
      timestamp: result.timestamp,
      status: result.status,
      amountDisbursed: result.amountDisbursed,
      metadata: result.metadata,
    };
  }
}
