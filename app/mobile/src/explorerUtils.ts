const STELLAR_TESTNET_EXPLORER_BASE = "https://stellar.expert/explorer/testnet";

export function getTxExplorerUrl(txHash: string): string {
  return `${STELLAR_TESTNET_EXPLORER_BASE}/tx/${txHash}`;
}

export function getContractExplorerUrl(contractId: string): string {
  return `${STELLAR_TESTNET_EXPLORER_BASE}/contract/${contractId}`;
}

export function getAccountExplorerUrl(address: string): string {
  return `${STELLAR_TESTNET_EXPLORER_BASE}/account/${address}`;
}
