/**
 * contracts/registry/index.ts
 *
 * Type-safe loader for the Soter Testnet Contract Registry.
 * Exposes contract IDs and config to both the Next.js frontend
 * and the NestJS backend without manual copy-paste.
 *
 * Usage:
 *   import { registry, getContractId } from '../../contracts/registry'
 */

import rawRegistry from './testnet.registry.json'

// ---- types ------------------------------------------------------------------

export interface ContractEntry {
  contract_id: string
  deployer_address: string
  wasm_hash: string
  deployed_at: string
  deployed_at_commit: string
  init_args: Record<string, unknown>
  description: string
  source: string
  abi_path: string
}

export interface TokenEntry {
  asset_code: string
  issuer: string
  contract_id: string
  decimals: number
  note: string
}

export interface RegistryMeta {
  description: string
  network: string
  network_passphrase: string
  soroban_rpc_url: string
  horizon_url: string
  schema_version: string
  last_updated: string
  deployed_at_commit: string
  maintainer: string
}

export interface ContractRegistry {
  _meta: RegistryMeta
  contracts: Record<string, ContractEntry>
  tokens: Record<string, TokenEntry>
}

// ---- exports ----------------------------------------------------------------

export const registry = rawRegistry as ContractRegistry

/**
 * Returns a contract's ID by name, or throws if not found.
 * @example getContractId('aid_escrow')
 */
export function getContractId(name: keyof typeof rawRegistry.contracts): string {
  const entry = registry.contracts[name]
  if (!entry) throw new Error(`[Soter Registry] Unknown contract: "${name}"`)
  if (entry.contract_id.startsWith('REPLACE_WITH')) {
    throw new Error(
      `[Soter Registry] Contract "${name}" has not been deployed yet. ` +
      `Run: ./contracts/registry/update-registry.sh`
    )
  }
  return entry.contract_id
}

/**
 * Returns a token's Stellar Asset Contract (SAC) ID by symbol.
 * @example getTokenContractId('USDC')
 */
export function getTokenContractId(symbol: keyof typeof rawRegistry.tokens): string {
  const token = registry.tokens[symbol]
  if (!token) throw new Error(`[Soter Registry] Unknown token: "${symbol}"`)
  return token.contract_id
}

export default registry