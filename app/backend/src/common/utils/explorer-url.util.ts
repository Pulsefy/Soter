const EXPLORER_BASE: Record<string, string> = {
  mainnet: 'https://stellar.expert/explorer/public',
  testnet: 'https://stellar.expert/explorer/testnet',
  futurenet: 'https://stellar.expert/explorer/futurenet',
};

/** Returns the explorer base URL for the given network, defaulting to testnet. */
export function explorerBase(network: string): string {
  return EXPLORER_BASE[network.toLowerCase()] ?? EXPLORER_BASE['testnet'];
}

/** Returns a link to a transaction on stellar.expert. */
export function explorerTxUrl(txHash: string, network: string): string {
  return `${explorerBase(network)}/tx/${txHash}`;
}

/** Returns a link to a contract (account) on stellar.expert. */
export function explorerContractUrl(
  contractId: string,
  network: string,
): string {
  return `${explorerBase(network)}/contract/${contractId}`;
}
