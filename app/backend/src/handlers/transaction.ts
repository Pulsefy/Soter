import { Request, Response } from 'express';

interface SubmitTransactionRequest {
  _transactionXdr: string; // underscore = intentionally unused
  networkPassphrase?: string; // will be renamed with underscore
}

// POST /v1/transactions/submit
export const submitTransaction = (req: Request, res: Response) => {
  // Mark unused networkPassphrase with underscore prefix
  const { _transactionXdr, networkPassphrase: _networkPassphrase } =
    req.body as SubmitTransactionRequest;

  try {
    const result = {
      hash: 'stub-hash-' + Date.now(),
      resultXdr: 'AAAAAAA=',
      ledger: 1,
    };
    return res.status(200).json(result);
  } catch (error: unknown) {
    // Safe error message access
    const detail = error instanceof Error ? error.message : String(error);
    return res.status(502).json({
      error: 'transaction_failed',
      detail,
    });
  }
};

// GET /v1/transactions/:hash
export const getTransaction = (req: Request, res: Response) => {
  const { hash } = req.params;
  return res.status(404).json({ error: 'not_found', hash });
};
