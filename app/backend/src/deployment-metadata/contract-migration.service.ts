import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ONCHAIN_ADAPTER_TOKEN,
  OnchainAdapter,
} from '../onchain/onchain.adapter';
import { DeploymentMetadataResponseDto } from './dto/deployment-metadata.dto';
import { DeploymentMetadataService } from './deployment-metadata.service';

/**
 * Result of a verified `migrate` trigger.
 *
 * `previousVersion` / `contractVersion` are the versions the chain reported
 * before and after the transaction — the evidence the metadata update is based
 * on — not the values the caller asked for.
 */
export interface ContractMigrationResult {
  deploymentId: string;
  contractName: string;
  network: string;
  contractId: string;
  previousVersion: string;
  contractVersion: string;
  transactionHash: string;
  migratedAt: Date;
  metadata: DeploymentMetadataResponseDto;
}

/**
 * Admin-triggered on-chain contract migration.
 *
 * The contract's `migrate(env, new_version)` upgrades on-chain state between
 * contract versions, but the deployment metadata that describes the contract
 * has to be rolled forward by hand afterwards. This service makes that a
 * single, verifiable step:
 *
 * 1. read the version the chain currently reports,
 * 2. submit `migrate(newVersion)`,
 * 3. read the version again and require that it actually changed (and matches
 *    the requested version),
 * 4. only then update `DeploymentMetadata`.
 *
 * Every failure mode — unknown deployment, failed pre-flight guard, submission
 * error, unchanged version, mismatched version — throws before step 4, so the
 * stored metadata never advertises a migration that did not happen. The
 * runbook in `docs/contract-migration-runbook.md` covers pre-flight checks,
 * the trigger and rollback.
 */
@Injectable()
export class ContractMigrationService {
  private readonly logger = new Logger(ContractMigrationService.name);

  constructor(
    private readonly deployments: DeploymentMetadataService,
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly adapter: OnchainAdapter,
  ) {}

  async migrateDeployment(
    deploymentId: string,
    newVersion: number,
    expectedCurrentVersion?: string,
  ): Promise<ContractMigrationResult> {
    const deployment = await this.deployments.findById(deploymentId);
    if (!deployment) {
      throw new NotFoundException(
        `No deployment metadata found for id ${deploymentId}`,
      );
    }

    const targetVersion = String(newVersion);
    const label = `${deployment.network}/${deployment.contractName}`;

    const previousVersion = await this.readOnChainVersion(
      label,
      'before submitting the migration',
    );

    if (
      expectedCurrentVersion !== undefined &&
      previousVersion !== expectedCurrentVersion
    ) {
      throw new ConflictException(
        `Pre-flight version check failed for ${label}: the chain reports version ` +
          `${previousVersion}, expected ${expectedCurrentVersion}. Nothing was submitted ` +
          `and deployment metadata was not modified.`,
      );
    }

    if (previousVersion === targetVersion) {
      throw new ConflictException(
        `${label} already reports version ${targetVersion}; there is nothing to migrate. ` +
          `Deployment metadata was not modified.`,
      );
    }

    this.logger.log(
      `Submitting migrate(${targetVersion}) for ${label} (${deployment.contractId})`,
    );

    const submission = await this.adapter.migrateContract({
      contractId: deployment.contractId,
      newVersion,
    });

    const reportedVersion = await this.verifyVersionChanged(
      label,
      submission.transactionHash,
      previousVersion,
      targetVersion,
    );

    const updated = await this.deployments.recordVerifiedMigration(
      deployment.id,
      {
        transactionHash: submission.transactionHash,
        previousVersion,
        contractVersion: reportedVersion,
        migratedAt: submission.timestamp ?? new Date(),
      },
    );

    this.logger.log(
      `Verified migrate(${targetVersion}) for ${label} in tx ${submission.transactionHash}; ` +
        `deployment metadata ${deployment.id} rolled forward (${previousVersion} -> ${reportedVersion})`,
    );

    return {
      deploymentId: deployment.id,
      contractName: deployment.contractName,
      network: deployment.network,
      contractId: deployment.contractId,
      previousVersion,
      contractVersion: reportedVersion,
      transactionHash: submission.transactionHash,
      migratedAt: submission.timestamp ?? new Date(),
      metadata: updated,
    };
  }

  /** Read the version the chain reports, mapped to a 502 with context. */
  private async readOnChainVersion(
    label: string,
    phase: string,
  ): Promise<string> {
    try {
      const metadata = await this.adapter.getContractMetadata();
      return String(metadata.version);
    } catch (error: unknown) {
      throw new BadGatewayException(
        `Could not read the on-chain version for ${label} ${phase}: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          `Deployment metadata was not modified.`,
      );
    }
  }

  /**
   * Require the chain to report a version that changed, and to match the
   * version that was requested. Failure here means the migration cannot be
   * confirmed, so the metadata update is skipped and the transaction hash is
   * surfaced for manual reconciliation.
   */
  private async verifyVersionChanged(
    label: string,
    transactionHash: string,
    previousVersion: string,
    targetVersion: string,
  ): Promise<string> {
    const reportedVersion = await this.readOnChainVersion(
      label,
      `after migrate(${targetVersion}) in tx ${transactionHash}`,
    );

    if (reportedVersion === previousVersion) {
      throw new BadGatewayException(
        `migrate(${targetVersion}) was submitted (tx ${transactionHash}) but ${label} still ` +
          `reports version ${previousVersion}. Deployment metadata was not modified; ` +
          `reconcile the deployment manually before retrying.`,
      );
    }

    if (reportedVersion !== targetVersion) {
      throw new BadGatewayException(
        `${label} reports version ${reportedVersion} after migrate(${targetVersion}) ` +
          `(tx ${transactionHash}). Refusing to record an unverified migration; ` +
          `deployment metadata was not modified.`,
      );
    }

    return reportedVersion;
  }
}
