import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ContractRegistrySyncService } from './contract-registry-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContractConfigCacheService } from './contract-config-cache.service';

describe('ContractRegistrySyncService', () => {
  let service: ContractRegistrySyncService;

  const configValues: Record<string, string | undefined> = {};
  const mockConfig = {
    get: jest.fn((key: string) => configValues[key]),
  };
  const mockPrisma = {
    deploymentMetadata: {
      upsert: jest.fn(),
    },
  };
  const mockCache = {
    invalidateAll: jest.fn(),
  };

  function writeRegistry(payload: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'soter-contract-registry-sync-'));
    const path = join(dir, 'registry.json');
    writeFileSync(path, JSON.stringify(payload), 'utf8');
    return path;
  }

  beforeEach(async () => {
    for (const key of Object.keys(configValues)) {
      delete configValues[key];
    }
    jest.clearAllMocks();
    mockPrisma.deploymentMetadata.upsert.mockResolvedValue({});
    mockCache.invalidateAll.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractRegistrySyncService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ContractConfigCacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get(ContractRegistrySyncService);
  });

  it('upserts deployments from the configured onchain registry artifact', async () => {
    configValues.CONTRACT_REGISTRY_PATH = writeRegistry({
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

    const result = await service.syncFromConfiguredSource();

    expect(result.source.kind).toBe('artifact');
    expect(result.contractCount).toBe(1);
    expect(result.networkCount).toBe(1);
    expect(mockPrisma.deploymentMetadata.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          network_contractName: {
            network: 'testnet',
            contractName: 'aid_escrow',
          },
        },
        update: expect.objectContaining({
          contractId:
            'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
        }),
      }),
    );
    expect(mockCache.invalidateAll).toHaveBeenCalledTimes(1);
  });

  it('falls back to env when no artifact exists but contract ID config is present', async () => {
    configValues.CONTRACT_REGISTRY_PATH = '/not/a/real/registry.json';
    configValues.AID_ESCROW_CONTRACT_ID = 'CENV123';

    const result = await service.syncFromConfiguredSource();

    expect(result.source.kind).toBe('env');
    expect(result.source.reason).toContain('CONTRACT_REGISTRY_PATH not found');
    expect(mockPrisma.deploymentMetadata.upsert).not.toHaveBeenCalled();
    expect(mockCache.invalidateAll).not.toHaveBeenCalled();
  });

  it('falls back to database when registry sync is disabled', async () => {
    configValues.CONTRACT_REGISTRY_SYNC_DISABLED = 'true';

    const result = await service.syncFromConfiguredSource();

    expect(result.source.kind).toBe('database');
    expect(result.source.reason).toContain('CONTRACT_REGISTRY_SYNC_DISABLED');
    expect(mockPrisma.deploymentMetadata.upsert).not.toHaveBeenCalled();
  });

  it('does not disable sync when CONTRACT_REGISTRY_SYNC_DISABLED is false', async () => {
    configValues.CONTRACT_REGISTRY_SYNC_DISABLED = 'false';
    configValues.CONTRACT_REGISTRY_PATH = '/not/a/real/registry.json';
    configValues.AID_ESCROW_CONTRACT_ID = 'CENV123';

    const result = await service.syncFromConfiguredSource();

    expect(result.source.kind).toBe('env');
    expect(result.source.reason).toContain('CONTRACT_REGISTRY_PATH not found');
  });
});
