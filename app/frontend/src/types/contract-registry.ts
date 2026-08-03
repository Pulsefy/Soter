export interface ContractNetworkDeployment {
  contract_id: string;
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
  source: {
    canonical_path: string;
    generator_script: string;
    deployment_registry: string;
  };
}

export type ContractRegistryState = 'ready' | 'loading' | 'error';

export interface ContractRegistryResult {
  state: ContractRegistryState;
  data: ContractRegistryResponse | null;
  error: Error | null;
  lastChecked: Date | null;
}
