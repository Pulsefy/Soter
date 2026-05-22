import { stellarNetwork } from './env';

const STELLAR_EXPERT_NETWORKS: Record<string, string> = {
  mainnet: 'public',
  public: 'public',
  testnet: 'testnet',
  futurenet: 'futurenet',
};

export function getStellarExpertTransactionUrl(
  transactionHash?: string | null,
): string | null {
  const normalizedHash = transactionHash?.trim();

  if (!normalizedHash) {
    return null;
  }

  const normalizedNetwork = stellarNetwork.trim().toLowerCase();
  const explorerNetwork = STELLAR_EXPERT_NETWORKS[normalizedNetwork];

  if (!explorerNetwork) {
    return null;
  }

  return `https://stellar.expert/explorer/${explorerNetwork}/tx/${encodeURIComponent(normalizedHash)}`;
}
