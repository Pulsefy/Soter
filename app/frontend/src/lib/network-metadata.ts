import { stellarNetwork, contractId } from './env';

// ---------------------------------------------------------------------------
// Network labels & helpers
// ---------------------------------------------------------------------------

/** Human-readable label for a network key (e.g. "testnet" → "Testnet"). */
export function networkLabel(network: string): string {
  const lower = network.toLowerCase();
  if (lower === 'mainnet' || lower === 'public') return 'Mainnet';
  if (lower === 'testnet') return 'Testnet';
  if (lower === 'futurenet') return 'Futurenet';
  if (lower === 'standalone') return 'Standalone';
  return network;
}

/** Short colour class for a network badge. */
export function networkBadgeColor(network: string): string {
  const lower = network.toLowerCase();
  if (lower === 'mainnet' || lower === 'public')
    return 'bg-green-600 dark:bg-green-700';
  if (lower === 'testnet') return 'bg-blue-600 dark:bg-blue-700';
  if (lower === 'futurenet') return 'bg-purple-600 dark:bg-purple-700';
  return 'bg-gray-600 dark:bg-gray-700';
}

// ---------------------------------------------------------------------------
// Explorer helpers (consolidated – replaces ad-hoc buildExplorerUrl copies)
// ---------------------------------------------------------------------------

export type ExplorerLinkType = 'contract' | 'tx' | 'address' | 'account';

/**
 * Maps a Stellar network string to the slug used by Stellar Expert URLs.
 * Mainnet is represented as "public" on the explorer.
 */
export function explorerNetworkSlug(network: string): string {
  const lower = network.toLowerCase();
  if (lower === 'mainnet' || lower === 'public') return 'public';
  if (lower === 'futurenet') return 'futurenet';
  return 'testnet';
}

/**
 * Build a Stellar Expert explorer URL for the given type, identifier and
 * network.  Falls back to the globally-configured network when `network`
 * is omitted.
 */
export function buildExplorerUrl(
  type: ExplorerLinkType,
  identifier: string,
  network = stellarNetwork,
): string {
  const slug = explorerNetworkSlug(network);
  return `https://stellar.expert/explorer/${slug}/${type}/${identifier}`;
}

// ---------------------------------------------------------------------------
// Truncated ID helper (consistent across surfaces)
// ---------------------------------------------------------------------------

/**
 * Return a truncated representation of a long identifier for display.
 * e.g. "CDSBJ2…6JG"
 */
export function truncateId(id: string, prefixLen = 6, suffixLen = 4): string {
  if (!id) return '';
  if (id.length <= prefixLen + suffixLen + 3) return id;
  return `${id.slice(0, prefixLen)}\u2026${id.slice(-suffixLen)}`;
}

// ---------------------------------------------------------------------------
// Active contract metadata (for admin & receipt surfaces)
// ---------------------------------------------------------------------------

export interface ActiveContractMeta {
  /** Stellar network key (testnet, mainnet, …) */
  network: string;
  /** Human-readable network label */
  networkLabel: string;
  /** The currently-active contract ID (or null if unconfigured) */
  contractId: string | null;
  /** Explorer link to the active contract */
  contractExplorerUrl: string | null;
  /** Application environment name (dev, staging, prod) */
  envName: string | null;
}

/**
 * Returns metadata about the currently-active deployment.  Safe to call
 * from any client component — no secrets are exposed.
 */
export function getActiveContractMeta(): ActiveContractMeta {
  const nid = stellarNetwork;
  const cid = contractId ?? null;
  return {
    network: nid,
    networkLabel: networkLabel(nid),
    contractId: cid,
    contractExplorerUrl: cid ? buildExplorerUrl('contract', cid, nid) : null,
    envName: null, // caller can override from env import if needed
  };
}
