'use client';

import { useState, useCallback } from 'react';

export enum TransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export interface Transaction {
  id: string;
  hash?: string;
  explorerUrl?: string;
  status: TransactionStatus;
  createdAt: Date;
  updatedAt?: Date;
  error?: string;
}

export function useTransactionTracker() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const createPendingTx = useCallback(() => {
    const tx: Transaction = {
      id: crypto.randomUUID(),
      status: TransactionStatus.PENDING,
      createdAt: new Date(),
    };

    setTransactions(prev => [tx, ...prev]);
    return tx.id;
  }, []);

  const markSuccess = useCallback((
    id: string,
    hash: string,
    explorerUrl: string,
  ) => {
    setTransactions(prev =>
      prev.map(tx =>
        tx.id === id
          ? {
              ...tx,
              hash,
              explorerUrl,
              status: TransactionStatus.SUCCESS,
            }
          : tx,
      ),
    );
  }, []);

  const markFailed = useCallback((
    id: string,
    error: string,
  ) => {
    setTransactions(prev =>
      prev.map(tx =>
        tx.id === id
          ? {
              ...tx,
              status: TransactionStatus.FAILED,
              error,
            }
          : tx,
      ),
    );
  }, []);

  const clearTransactions = useCallback(() => {
    setTransactions([]);
  }, []);

  const getPendingTransactions = useCallback(() => {
    return transactions.filter(tx => tx.status === TransactionStatus.PENDING);
  }, [transactions]);

  return {
    transactions,
    createPendingTx,
    markSuccess,
    markFailed,
    clearTransactions,
    getPendingTransactions,
  };
}
