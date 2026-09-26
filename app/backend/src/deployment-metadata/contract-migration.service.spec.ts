import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ContractMigrationService } from './contract-migration.service';
import { DeploymentMetadataService } from './deployment-metadata.service';
import { DeploymentMetadataResponseDto } from './dto/deployment-metadata.dto';
import { OnchainAdapter } from '../onchain/onchain.adapter';

describe('ContractMigrationService', () => {
  const deployment: DeploymentMetadataResponseDto = {
    id: 'dep-1',
    contractName: 'AidEscrow',
    network: 'testnet',
    contractId: 'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
    wasmHash:
      '24328e15b7c11c7ff07caeaf0328da591b3b63e84af57fa03623c10126eabc8d',
    deployedAt: new Date('2026-06-03T12:00:00Z'),
    transactionHash: 'deploy-tx',
    metadata: { version: '1.0.0' },
    createdAt: new Date('2026-06-03T12:00:00Z'),
    updatedAt: new Date('2026-06-03T12:00:00Z'),
  };

  const migrated: DeploymentMetadataResponseDto = {
    ...deployment,
    transactionHash: 'migration-tx',
    metadata: {
      version: '1.0.0',
      contractVersion: '2',
      previousContractVersion: '1',
      migratedAt: '2026-09-26T00:00:00.000Z',
    },
  };

  let service: ContractMigrationService;
  let adapter: {
    getContractMetadata: jest.Mock;
    migrateContract: jest.Mock;
  };
  let deployments: {
    findById: jest.Mock;
    recordVerifiedMigration: jest.Mock;
  };

  const migratedAt = new Date('2026-09-26T00:00:00.000Z');

  /** Build the service with the version the chain reports at each read. */
  const setup = (versions: (string | Error)[]) => {
    adapter = {
      getContractMetadata: jest.fn(),
      migrateContract: jest.fn().mockResolvedValue({
        contractId: deployment.contractId,
        newVersion: 2,
        transactionHash: 'migration-tx',
        timestamp: migratedAt,
        status: 'success',
      }),
    };

    for (const version of versions) {
      if (version instanceof Error) {
        adapter.getContractMetadata.mockRejectedValueOnce(version);
      } else {
        adapter.getContractMetadata.mockResolvedValueOnce({
          version,
          name: 'Soroban AidEscrow Contract',
          timestamp: new Date(),
        });
      }
    }

    deployments = {
      findById: jest.fn().mockResolvedValue(deployment),
      recordVerifiedMigration: jest.fn().mockResolvedValue(migrated),
    };

    service = new ContractMigrationService(
      deployments as unknown as DeploymentMetadataService,
      adapter as unknown as OnchainAdapter,
    );
  };

  it('updates deployment metadata only after the reported version changes', async () => {
    setup(['1', '2']);

    const result = await service.migrateDeployment(deployment.id, 2);

    expect(adapter.migrateContract).toHaveBeenCalledWith({
      contractId: deployment.contractId,
      newVersion: 2,
    });
    expect(deployments.recordVerifiedMigration).toHaveBeenCalledWith(
      deployment.id,
      {
        transactionHash: 'migration-tx',
        previousVersion: '1',
        contractVersion: '2',
        migratedAt,
      },
    );
    expect(result).toMatchObject({
      deploymentId: deployment.id,
      contractId: deployment.contractId,
      previousVersion: '1',
      contractVersion: '2',
      transactionHash: 'migration-tx',
      metadata: migrated,
    });
  });

  it('reads the on-chain version once before and once after submitting', async () => {
    setup(['1', '2']);

    await service.migrateDeployment(deployment.id, 2);

    expect(adapter.getContractMetadata).toHaveBeenCalledTimes(2);
  });

  it('rejects an unknown deployment without touching the chain', async () => {
    setup([]);
    deployments.findById.mockResolvedValue(null);

    await expect(
      service.migrateDeployment('missing', 2),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(adapter.migrateContract).not.toHaveBeenCalled();
    expect(deployments.recordVerifiedMigration).not.toHaveBeenCalled();
  });

  it('fails the pre-flight guard without submitting when the version differs', async () => {
    setup(['3']);

    await expect(
      service.migrateDeployment(deployment.id, 4, '1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(adapter.migrateContract).not.toHaveBeenCalled();
    expect(deployments.recordVerifiedMigration).not.toHaveBeenCalled();
  });

  it('passes the pre-flight guard when the expected version matches', async () => {
    setup(['1', '2']);

    await expect(
      service.migrateDeployment(deployment.id, 2, '1'),
    ).resolves.toMatchObject({ contractVersion: '2' });

    expect(adapter.migrateContract).toHaveBeenCalledTimes(1);
  });

  it('refuses to migrate when the contract already reports the target version', async () => {
    setup(['2']);

    await expect(
      service.migrateDeployment(deployment.id, 2),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(adapter.migrateContract).not.toHaveBeenCalled();
    expect(deployments.recordVerifiedMigration).not.toHaveBeenCalled();
  });

  it('leaves metadata untouched when the reported version did not change', async () => {
    setup(['1', '1']);

    await expect(service.migrateDeployment(deployment.id, 2)).rejects.toThrow(
      /still\s+reports version 1/,
    );

    expect(deployments.recordVerifiedMigration).not.toHaveBeenCalled();
  });

  it('leaves metadata untouched when the reported version is not the requested one', async () => {
    setup(['1', '3']);

    await expect(service.migrateDeployment(deployment.id, 2)).rejects.toThrow(
      BadGatewayException,
    );

    expect(deployments.recordVerifiedMigration).not.toHaveBeenCalled();
  });

  it('surfaces the transaction hash when verification fails, for reconciliation', async () => {
    setup(['1', '1']);

    await expect(service.migrateDeployment(deployment.id, 2)).rejects.toThrow(
      /migration-tx/,
    );
  });

  it('leaves metadata untouched when the submission itself fails', async () => {
    setup(['1']);
    adapter.migrateContract.mockRejectedValue(new Error('simulation error'));

    await expect(service.migrateDeployment(deployment.id, 2)).rejects.toThrow(
      'simulation error',
    );

    expect(deployments.recordVerifiedMigration).not.toHaveBeenCalled();
  });

  it('leaves metadata untouched when the post-migration version read fails', async () => {
    setup(['1', new Error('rpc unavailable')]);

    await expect(
      service.migrateDeployment(deployment.id, 2),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(deployments.recordVerifiedMigration).not.toHaveBeenCalled();
  });

  it('does not submit when the pre-migration version read fails', async () => {
    setup([new Error('rpc unavailable')]);

    await expect(
      service.migrateDeployment(deployment.id, 2),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(adapter.migrateContract).not.toHaveBeenCalled();
    expect(deployments.recordVerifiedMigration).not.toHaveBeenCalled();
  });

  it('does not submit when the adapter rejects a mismatched contract id', async () => {
    setup(['1']);
    adapter.migrateContract.mockRejectedValue(
      new Error('Refusing to migrate contract C_OTHER'),
    );

    await expect(service.migrateDeployment(deployment.id, 2)).rejects.toThrow(
      /Refusing to migrate/,
    );

    expect(deployments.recordVerifiedMigration).not.toHaveBeenCalled();
  });
});
