import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export type ContractRegistrySourceKind =
  | 'artifact'
  | 'env'
  | 'database'
  | 'missing';

export interface ContractRegistrySource {
  kind: ContractRegistrySourceKind;
  path?: string;
  reason?: string;
}

export interface ContractDeploymentArtifactRecord {
  contractName: string;
  network: string;
  contractId: string;
  wasmHash: string;
  deployedAt: string;
  commitSha?: string | null;
  deployer?: string | null;
  transactionHash?: string | null;
  metadata: Record<string, unknown>;
}

interface LegacyDeploymentRecord {
  network?: string;
  version?: string;
  contract_id?: string;
  wasm_hash?: string;
  deployer?: string;
  init_args?: Record<string, unknown>;
  deployed_at?: string;
  git_commit?: string | null;
  version_tag?: string;
  record?: string;
  transaction_hash?: string | null;
  deploy_tx_hash?: string | null;
  contract_name?: string;
}

interface GeneratedNetworkRecord {
  contract_id?: string;
  version?: string;
  deployed_at?: string;
  wasm_hash?: string;
  deployer?: string;
  transaction_hash?: string | null;
  git_commit?: string | null;
  metadata?: Record<string, unknown>;
}

interface GeneratedContractRecord {
  version?: string;
  networks?: Record<string, GeneratedNetworkRecord>;
}

export const DEFAULT_REGISTRY_RELATIVE_PATH = join(
  'app',
  'onchain',
  'deployments',
  'registry.json',
);

export function resolveRegistryArtifactPath(
  configuredPath?: string,
  cwd = process.cwd(),
): string | null {
  if (configuredPath?.trim()) {
    const resolvedPath = isAbsolute(configuredPath)
      ? configuredPath
      : resolve(cwd, configuredPath);
    return existsSync(resolvedPath) ? resolvedPath : null;
  }

  const candidates = [
    resolve(cwd, DEFAULT_REGISTRY_RELATIVE_PATH),
    resolve(cwd, '..', 'onchain', 'deployments', 'registry.json'),
    resolve(cwd, 'deployments', 'registry.json'),
  ];

  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

export function loadContractRegistryArtifact(
  artifactPath: string,
): ContractDeploymentArtifactRecord[] {
  const raw = readFileSync(artifactPath, 'utf8');
  const parsed = JSON.parse(raw) as {
    contract?: string;
    deployments?: LegacyDeploymentRecord[];
    contracts?: Record<string, GeneratedContractRecord>;
  };

  if (Array.isArray(parsed.deployments)) {
    return fromLegacyRegistry(parsed.contract, parsed.deployments);
  }

  if (parsed.contracts && typeof parsed.contracts === 'object') {
    return fromGeneratedRegistry(parsed.contracts);
  }

  throw new Error(
    'Unsupported contract registry artifact format: expected deployments[] or contracts{}',
  );
}

export function findLatestDeployment(
  records: ContractDeploymentArtifactRecord[],
  network: string,
  contractName: string,
): ContractDeploymentArtifactRecord | null {
  const normalizedName = normalizeContractName(contractName);
  const matches = records
    .filter(
      record =>
        record.network === network &&
        normalizeContractName(record.contractName) === normalizedName,
    )
    .sort(
      (a, b) =>
        new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime(),
    );

  return matches[0] ?? null;
}

export function normalizeContractName(contractName: string): string {
  return contractName.replace(/[_-]/g, '').toLowerCase();
}

function fromLegacyRegistry(
  defaultContractName: string | undefined,
  deployments: LegacyDeploymentRecord[],
): ContractDeploymentArtifactRecord[] {
  return deployments
    .map((dep): ContractDeploymentArtifactRecord | null => {
      const contractName = dep.contract_name ?? defaultContractName;
      if (!contractName || !dep.network || !dep.contract_id) return null;

      return {
        contractName,
        network: dep.network,
        contractId: dep.contract_id,
        wasmHash: dep.wasm_hash ?? '',
        deployedAt: dep.deployed_at ?? new Date(0).toISOString(),
        commitSha: dep.git_commit ?? null,
        deployer: dep.deployer ?? null,
        transactionHash: dep.transaction_hash ?? dep.deploy_tx_hash ?? null,
        metadata: {
          source: 'onchain-registry',
          version: dep.version,
          versionTag: dep.version_tag,
          record: dep.record,
          initArgs: dep.init_args,
        },
      };
    })
    .filter((item): item is ContractDeploymentArtifactRecord => item !== null);
}

function fromGeneratedRegistry(
  contracts: Record<string, GeneratedContractRecord>,
): ContractDeploymentArtifactRecord[] {
  const records: ContractDeploymentArtifactRecord[] = [];

  for (const [contractName, contract] of Object.entries(contracts)) {
    for (const [network, networkRecord] of Object.entries(
      contract.networks ?? {},
    )) {
      if (!networkRecord.contract_id) continue;
      records.push({
        contractName,
        network,
        contractId: networkRecord.contract_id,
        wasmHash: networkRecord.wasm_hash ?? '',
        deployedAt: networkRecord.deployed_at ?? new Date(0).toISOString(),
        commitSha: networkRecord.git_commit ?? null,
        deployer: networkRecord.deployer ?? null,
        transactionHash: networkRecord.transaction_hash ?? null,
        metadata: {
          source: 'contract-registry',
          version: networkRecord.version ?? contract.version,
          ...(networkRecord.metadata ?? {}),
        },
      });
    }
  }

  return records;
}
