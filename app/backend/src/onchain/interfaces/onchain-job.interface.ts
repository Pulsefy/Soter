export enum OnchainOperationType {
  INIT_ESCROW = 'init-escrow',
  CREATE_CLAIM = 'create-claim',
  DISBURSE = 'disburse',
  EVENT_CORRELATION = 'event-correlation',
  EVENT_CORRELATION_TRANSACTION = 'event-correlation-transaction',
}

export interface OnchainJobData {
  type: OnchainOperationType;
  params: any;
  timestamp: number;
  correlationId?: string;
}

export interface OnchainJobResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
  metadata?: Record<string, any>;
}
