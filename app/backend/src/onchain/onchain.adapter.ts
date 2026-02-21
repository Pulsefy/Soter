/**
 * On-chain adapter interface for Soroban AidEscrow contract interactions
 */

export interface InitEscrowParams {
  adminAddress: string;
}

export interface InitEscrowResult {
  escrowAddress: string;
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  metadata?: Record<string, any>;
}

export interface CreateClaimParams {
  claimId: string;
  recipientAddress: string;
  amount: string; // Amount as string to preserve precision
  tokenAddress: string;
  expiresAt?: number; // Unix timestamp, optional
}

export interface CreateClaimResult {
  packageId: string;
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  metadata?: Record<string, any>;
}

export interface DisburseParams {
  claimId: string;
  packageId: string;
  recipientAddress?: string;
  amount?: string;
}

export interface DisburseResult {
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  amountDisbursed: string;
  metadata?: Record<string, any>;
}

/**
 * Interface for on-chain operations with Soroban AidEscrow contract
 */
export interface OnchainAdapter {
  /**
   * Initialize the escrow contract with an admin address
   */
  initEscrow(params: InitEscrowParams): Promise<InitEscrowResult>;

  /**
   * Create a claim package on-chain
   */
  createClaim(params: CreateClaimParams): Promise<CreateClaimResult>;

  /**
   * Disburse funds for a claim package
   */
  disburse(params: DisburseParams): Promise<DisburseResult>;
}
