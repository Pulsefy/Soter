import { config } from './config';

function explorerBase(network?: string): string {
  const n = (network ?? config.network).toLowerCase();
  if (n === 'mainnet' || n === 'public') {
    return 'https://stellar.expert/explorer/public';
  }
  return 'https://stellar.expert/explorer/testnet';
}

export function getTxExplorerUrl(txHash: string, network?: string): string {
  return `${explorerBase(network)}/tx/${txHash}`;
}

export function getContractExplorerUrl(contractId: string, network?: string): string {
  return `${explorerBase(network)}/contract/${contractId}`;
}

export function getAccountExplorerUrl(address: string, network?: string): string {
  return `${explorerBase(network)}/account/${address}`;
}
