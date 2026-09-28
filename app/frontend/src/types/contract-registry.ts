/**
 * Types for the contract registry consumed by the frontend.
 *
 * This mirrors the output of `app/onchain/scripts/generate-registry.py`
 * (see the docstring there for the authoritative shape):
 *
 * {
 *   "schema_version": 2,
 *   "generated_at": "2026-07-24T...",
 *   "contracts": {
 *     "aid_escrow": {
 *       "version": "0.2.0",
 *       "networks": {
 *         "testnet": {
 *           "contract_id": "C...",
 *           "wasm_hash": "<64 hex chars>",
 *           "version": "0.1.0",
 *           "deployed_at": "2026-06-03"
 *         }
 *       }
 *     }
 *   }
 * }
 */
export interface ContractNetworkDeployment {
  contract_id: string;
  wasm_hash: string;
  version: string;
  deployed_at: string;
}

export interface ContractRegistryEntry {
  version: string;
  networks: Record<string, ContractNetworkDeployment>;
}

export interface ContractRegistryResponse {
  schema_version: number;
  generated_at: string;
  contracts: Record<string, ContractRegistryEntry>;
}

export type ContractRegistryState = 'ready' | 'loading' | 'error';

export interface ContractRegistryResult {
  state: ContractRegistryState;
  data: ContractRegistryResponse | null;
  error: Error | null;
  lastChecked: Date | null;
}
