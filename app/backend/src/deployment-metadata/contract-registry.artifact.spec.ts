import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findLatestDeployment,
  loadContractRegistryArtifact,
  resolveRegistryArtifactPath,
} from './contract-registry.artifact';

describe('contract-registry.artifact', () => {
  function writeRegistry(payload: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'soter-contract-registry-'));
    const path = join(dir, 'registry.json');
    writeFileSync(path, JSON.stringify(payload), 'utf8');
    return path;
  }

  it('loads canonical onchain deployments/registry.json records', () => {
    const path = writeRegistry({
      schema_version: 1,
      contract: 'aid_escrow',
      deployments: [
        {
          network: 'testnet',
          version: '0.1.0',
          contract_id:
            'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
          wasm_hash:
            '24328e15b7c11c7ff07caeaf0328da591b3b63e84af57fa03623c10126eabc8d',
          deployer: 'GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY',
          init_args: {
            admin: 'GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY',
          },
          deployed_at: '2026-06-03',
          git_commit: null,
          version_tag: 'v0.1.0-testnet',
          record: 'deployments/testnet-2026-06-03.md',
        },
      ],
    });

    const records = loadContractRegistryArtifact(path);

    expect(records).toEqual([
      expect.objectContaining({
        contractName: 'aid_escrow',
        network: 'testnet',
        contractId: 'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
        wasmHash:
          '24328e15b7c11c7ff07caeaf0328da591b3b63e84af57fa03623c10126eabc8d',
        deployer: 'GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY',
      }),
    ]);
    expect(records[0].metadata).toEqual(
      expect.objectContaining({
        source: 'onchain-registry',
        version: '0.1.0',
        versionTag: 'v0.1.0-testnet',
      }),
    );
  });

  it('loads generated contract-registry.json records', () => {
    const path = writeRegistry({
      schema_version: 2,
      contracts: {
        aid_escrow: {
          version: '0.2.0',
          networks: {
            testnet: {
              contract_id: 'CABC123',
              deployed_at: '2026-06-04T00:00:00Z',
              version: '0.2.1',
            },
          },
        },
      },
    });

    expect(loadContractRegistryArtifact(path)).toEqual([
      expect.objectContaining({
        contractName: 'aid_escrow',
        network: 'testnet',
        contractId: 'CABC123',
        metadata: expect.objectContaining({
          source: 'contract-registry',
          version: '0.2.1',
        }),
      }),
    ]);
  });

  it('finds the latest deployment for a network and contract name alias', () => {
    const latest = findLatestDeployment(
      [
        {
          contractName: 'aid_escrow',
          network: 'testnet',
          contractId: 'COLD',
          wasmHash: '',
          deployedAt: '2026-01-01',
          metadata: {},
        },
        {
          contractName: 'AidEscrow',
          network: 'testnet',
          contractId: 'CNEW',
          wasmHash: '',
          deployedAt: '2026-02-01',
          metadata: {},
        },
      ],
      'testnet',
      'aid_escrow',
    );

    expect(latest?.contractId).toBe('CNEW');
  });

  it('resolves configured relative paths from cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'soter-contract-registry-'));
    const path = join(dir, 'registry.json');
    writeFileSync(path, '{}', 'utf8');

    expect(resolveRegistryArtifactPath('registry.json', dir)).toBe(path);
  });
});
