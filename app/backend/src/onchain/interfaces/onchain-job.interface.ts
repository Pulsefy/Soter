export enum OnchainOperationType {
  INIT_ESCROW = 'init-escrow',
  CREATE_CLAIM = 'create-claim',
  DISBURSE = 'disburse',
  UPDATE_DELEGATE = 'update-delegate',
}

export interface OnchainJobData {
  type: OnchainOperationType;
  params: any;
  timestamp: number;
}

export interface OnchainJobResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
  metadata?: Record<string, any>;
}
