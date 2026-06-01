function createPendingTx() {
  const tx = {
    id: crypto.randomUUID(),
    status: TransactionStatus.PENDING,
    createdAt: Date.now(),
  };

  setTransactions(prev => [
    tx,
    ...prev,
  ]);

  return tx.id;
}

function markSuccess(
  id: string,
  hash: string,
  explorerUrl: string,
) {
  setTransactions(prev =>
    prev.map(tx =>
      tx.id === id
        ? {
            ...tx,
            hash,
            explorerUrl,
            status:
              TransactionStatus.SUCCESS,
          }
        : tx,
    ),
  );
}

function markFailed(
  id: string,
  error: string,
) {
  setTransactions(prev =>
    prev.map(tx =>
      tx.id === id
        ? {
            ...tx,
            status:
              TransactionStatus.FAILED,
            error,
          }
        : tx,
    ),
  );
}