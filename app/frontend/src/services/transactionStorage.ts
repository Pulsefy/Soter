const STORAGE_KEY =
  'recent-transactions';

export function getTransactions() {
  const data =
    localStorage.getItem(STORAGE_KEY);

  return data ? JSON.parse(data) : [];
}

export function saveTransactions(
  transactions: TransactionRecord[],
) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(transactions),
  );
}