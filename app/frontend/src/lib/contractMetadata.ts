/**
 * Shared data source for active contract IDs, network labels, and deployment metadata.
 *
 * Consumers (admin panels, receipt surfaces, explorer links) pull from here
 * so there is a single place to update when a contract is redeployed.
 *
 * Static values come from NEXT_PUBLIC_ env vars. The backend
 * DeploymentMetadataController provides richer DB-backed records for admins.
 */

import { stellarNetwork, apiUrl } from './env';
import { buildExplorerUrl } from './explorer';

export type NetworkName = 'testnet' | 'futurenet' | 'mainnet';

export interface ActiveContractConfig {
  /** Human-readable network label shown in UI (e.g. "Testnet", "Mainnet") */
  networkLabel: string;
  /** Raw network identifier aligned with SOROBAN_NETWORK values */
  network: NetworkName;
  /** On-chain contract ID (Soroban / Stellar address format) */
  contractId: string | null;
  /** stellar.expert explorer link for the contract, or null when contractId is absent */
  explorerUrl: string | null;
}

/** Deployment metadata record as returned by GET /deployment-metadata */
export interface DeploymentRecord {
  id: string;
  contractName: string;
  network: string;
  contractId: string;
  wasmHash: string;
  deployedAt: string;
  commitSha?: string;
  deployer?: string;
  transactionHash?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const NETWORK_LABELS: Record<string, string> = {
  testnet: 'Testnet',
  futurenet: 'Futurenet',
  mainnet: 'Mainnet',
  public: 'Mainnet',
  standalone: 'Standalone',
};

function normalizeNetwork(raw: string): NetworkName {
  const lower = raw.toLowerCase().trim();
  if (lower === 'mainnet' || lower === 'public') return 'mainnet';
  if (lower === 'futurenet') return 'futurenet';
  return 'testnet';
}

/**
 * Returns the active contract configuration derived from environment variables.
 * Use this for static, build-time contract info in receipt and UI surfaces.
 */
export function getActiveContractConfig(): ActiveContractConfig {
  const network = normalizeNetwork(stellarNetwork);
  const contractId =
    process.env.NEXT_PUBLIC_AID_ESCROW_CONTRACT_ID?.trim() || null;

  return {
    networkLabel: NETWORK_LABELS[network] ?? stellarNetwork,
    network,
    contractId,
    explorerUrl: contractId
      ? buildExplorerUrl('contract', contractId, network)
      : null,
  };
}

/**
 * Fetch all deployment records from the backend (admin use only).
 * Requires an authenticated session with admin role.
 */
export async function fetchDeploymentRecords(
  signal?: AbortSignal,
): Promise<DeploymentRecord[]> {
  const res = await fetch(`${apiUrl}/deployment-metadata`, {
    credentials: 'include',
    signal,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch deployment records: ${res.status}`);
  }
  return res.json() as Promise<DeploymentRecord[]>;
}

/**
 * Trigger a cache refresh on the backend (admin use only).
 */
export async function refreshContractCache(): Promise<{
  refreshedAt: string;
  contractCount: number;
  networkCount: number;
}> {
  const res = await fetch(`${apiUrl}/deployment-metadata/cache/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Cache refresh failed: ${res.status}`);
  }
  return res.json();
}
