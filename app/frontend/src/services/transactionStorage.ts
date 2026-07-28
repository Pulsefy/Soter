import type { Transaction } from '@/hooks/useTransactionTracker';

export interface TransactionRecord extends Transaction {
  synced?: boolean;
  lastSyncedAt?: Date;
}

const STORAGE_KEY = 'transactions';

export function saveTransactions(transactions: TransactionRecord[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}


export function loadTransactions(): TransactionRecord[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  
  try {
    const parsed = JSON.parse(stored) as TransactionRecord[];
    return parsed.map(tx => ({
      ...tx,
      createdAt: typeof tx.createdAt === 'string' ? new Date(tx.createdAt) : new Date(tx.createdAt),
      updatedAt: tx.updatedAt ? (typeof tx.updatedAt === 'string' ? new Date(tx.updatedAt) : new Date(tx.updatedAt)) : undefined,
      lastSyncedAt: tx.lastSyncedAt ? (typeof tx.lastSyncedAt === 'string' ? new Date(tx.lastSyncedAt) : new Date(tx.lastSyncedAt)) : undefined,
    }));
  } catch {
    return [];
  }
}

export function addTransactionToStorage(transaction: TransactionRecord): void {
  const transactions = loadTransactions();
  transactions.unshift(transaction);
  saveTransactions(transactions);
}

export function updateTransactionInStorage(id: string, updates: Partial<TransactionRecord>): void {
  const transactions = loadTransactions();
  const index = transactions.findIndex(tx => tx.id === id);
  if (index !== -1) {
    transactions[index] = { ...transactions[index], ...updates };
    saveTransactions(transactions);
  }
}

export function removeTransactionFromStorage(id: string): void {
  const transactions = loadTransactions();
  const filtered = transactions.filter(tx => tx.id !== id);
  saveTransactions(filtered);
}

export function clearTransactionsFromStorage(): void {
  saveTransactions([]);
}
