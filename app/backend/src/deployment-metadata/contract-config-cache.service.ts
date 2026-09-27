import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../cache/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { DeploymentMetadataResponseDto } from './dto/deployment-metadata.dto';

/**
 * TTL for cached contract ID / config snapshots (5 minutes).
 * Adjust via CONTRACT_CONFIG_CACHE_TTL_SECONDS env var.
 */
const DEFAULT_TTL_SECONDS = 300;

/**
 * Retry configuration for scheduled/admin cache refreshes.
 */
const MAX_REFRESH_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const CACHE_STALENESS_METRIC = 'deployment_metadata_cache_staleness_seconds';

/**
 * Key helpers – all keys live under the `contract-config:` namespace.
 */
const KEYS = {
  all: () => 'contract-config:all',
  byNetwork: (network: string) => `contract-config:network:${network}`,
  byNetworkAndName: (network: string, contractName: string) =>
    `contract-config:contract:${network}:${contractName}`,
  byContractId: (contractId: string) => `contract-config:id:${contractId}`,
  pattern: () => 'contract-config:*',
};

/**
 * ContractConfigCacheService
 *
 * Provides TTL-based Redis caching for contract deployment metadata
 * (contract IDs, wasm hashes, network config snapshots).
 *
 * All read helpers fall back to a direct DB query if the cache is cold
 * or Redis is unavailable, so the system is safe to run without Redis.
 *
 * Admin-triggered full refresh is available via `refreshAll()`.
 */
@Injectable()
export class ContractConfigCacheService {
  private readonly logger = new Logger(ContractConfigCacheService.name);
  private readonly ttl: number;
  private lastSuccessfulRefreshAt: Date | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {
    this.ttl =
      parseInt(process.env.CONTRACT_CONFIG_CACHE_TTL_SECONDS ?? '', 10) ||
      DEFAULT_TTL_SECONDS;
  }

  // ─── Public read helpers ────────────────────────────────────────────────────

  /**
   * Return all deployment metadata records.
   * Cache hit → Redis; miss → Prisma, then populate cache.
   */
  async getAll(): Promise<DeploymentMetadataResponseDto[]> {
    const key = KEYS.all();
    const cached = await this.redis.get<DeploymentMetadataResponseDto[]>(key);
    if (cached !== null) {
      this.logger.debug('cache hit: getAll');
      return cached;
    }

    this.logger.debug('cache miss: getAll – loading from DB');
    const rows = await this.prisma.deploymentMetadata.findMany({
      orderBy: { deployedAt: 'desc' },
    });
    const result = rows.map(r => this.mapToResponse(r));
    await this.redis.set(key, result, this.ttl);
    return result;
  }

  /**
   * Return all deployment metadata records for a given network.
   */
  async getByNetwork(
    network: string,
  ): Promise<DeploymentMetadataResponseDto[]> {
    const key = KEYS.byNetwork(network);
    const cached = await this.redis.get<DeploymentMetadataResponseDto[]>(key);
    if (cached !== null) {
      this.logger.debug(`cache hit: getByNetwork(${network})`);
      return cached;
    }

    this.logger.debug(`cache miss: getByNetwork(${network}) – loading from DB`);
    const rows = await this.prisma.deploymentMetadata.findMany({
      where: { network },
      orderBy: { deployedAt: 'desc' },
    });
    const result = rows.map(r => this.mapToResponse(r));
    await this.redis.set(key, result, this.ttl);
    return result;
  }

  /**
   * Return a single record by network + contract name.
   * Returns null (and does NOT throw) when not found – callers decide.
   */
  async getByNetworkAndContractName(
    network: string,
    contractName: string,
  ): Promise<DeploymentMetadataResponseDto | null> {
    const key = KEYS.byNetworkAndName(network, contractName);
    const cached = await this.redis.get<DeploymentMetadataResponseDto | null>(
      key,
    );
    if (cached !== undefined && cached !== null) {
      this.logger.debug(
        `cache hit: getByNetworkAndContractName(${network}, ${contractName})`,
      );
      return cached;
    }

    this.logger.debug(
      `cache miss: getByNetworkAndContractName(${network}, ${contractName}) – loading from DB`,
    );
    const row = await this.prisma.deploymentMetadata.findUnique({
      where: { network_contractName: { network, contractName } },
    });
    const result = row ? this.mapToResponse(row) : null;

    // Cache the result even when null so we don't hammer the DB on repeated
    // lookups for a contract that hasn't been deployed yet.
    await this.redis.set(key, result, this.ttl);
    return result;
  }

  /**
   * Return a single record by on-chain contract ID (address).
   */
  async getByContractId(
    contractId: string,
  ): Promise<DeploymentMetadataResponseDto | null> {
    const key = KEYS.byContractId(contractId);
    const cached = await this.redis.get<DeploymentMetadataResponseDto | null>(
      key,
    );
    if (cached !== undefined && cached !== null) {
      this.logger.debug(`cache hit: getByContractId(${contractId})`);
      return cached;
    }

    this.logger.debug(
      `cache miss: getByContractId(${contractId}) – loading from DB`,
    );
    const row = await this.prisma.deploymentMetadata.findFirst({
      where: { contractId },
    });
    const result = row ? this.mapToResponse(row) : null;
    await this.redis.set(key, result, this.ttl);
    return result;
  }

  // ─── Cache management ───────────────────────────────────────────────────────

  /**
   * Invalidate all contract-config cache keys.
   * Called automatically after write operations (create / update / delete).
   */
  async invalidateAll(): Promise<number> {
    const deleted = await this.redis.delByPattern(KEYS.pattern());
    this.logger.log(
      `contract-config cache invalidated: ${deleted} key(s) removed`,
    );
    return deleted;
  }

  /**
   * Warm the cache by loading all records from the DB.
   *
   * Transient failures are retried with exponential backoff within the same
   * refresh operation. Existing cache entries are only invalidated after the
   * database snapshot has been successfully loaded, so a failed refresh does
   * not unnecessarily destroy the last known-good cache.
   */
  async refreshAll(): Promise<{
    refreshedAt: Date;
    contractCount: number;
    networkCount: number;
  }> {
    this.logger.log('contract-config cache refresh requested');

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_REFRESH_ATTEMPTS; attempt++) {
      try {
        const result = await this.refreshOnce();

        this.lastSuccessfulRefreshAt = result.refreshedAt;
        this.metrics.setGauge(CACHE_STALENESS_METRIC, 0);

        return result;
      } catch (error) {
        lastError = error;

        if (attempt < MAX_REFRESH_ATTEMPTS) {
          const delayMs =
            INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1);

          this.logger.warn(
            `contract-config cache refresh transient failure ` +
              `(attempt ${attempt}/${MAX_REFRESH_ATTEMPTS}); ` +
              `retrying in ${delayMs}ms`,
          );

          await this.sleep(delayMs);
          continue;
        }

        const stalenessSeconds = this.lastSuccessfulRefreshAt
          ? Math.max(
              0,
              (Date.now() - this.lastSuccessfulRefreshAt.getTime()) / 1000,
            )
          : this.ttl;

        this.metrics.setGauge(
          CACHE_STALENESS_METRIC,
          stalenessSeconds,
        );

        const message =
          error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;

        this.logger.error(
          `contract-config cache refresh failed after ` +
            `${MAX_REFRESH_ATTEMPTS} attempts: ${message}`,
          stack,
        );
      }
    }

    throw lastError;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Perform one complete cache refresh attempt.
   */
  private async refreshOnce(): Promise<{
    refreshedAt: Date;
    contractCount: number;
    networkCount: number;
  }> {
    // 1. Load everything from Prisma first.
    // Keep the existing cache intact if this fails.
    const rows = await this.prisma.deploymentMetadata.findMany({
      orderBy: { deployedAt: 'desc' },
    });
    const all = rows.map(r => this.mapToResponse(r));

    // 2. Wipe the previous snapshot only after the DB read succeeded.
    await this.invalidateAll();

    // 3. Populate the "all" key.
    await this.redis.set(KEYS.all(), all, this.ttl);

    // 4. Populate per-network keys.
    const byNetwork = new Map<string, DeploymentMetadataResponseDto[]>();
    for (const item of all) {
      const list = byNetwork.get(item.network) ?? [];
      list.push(item);
      byNetwork.set(item.network, list);
    }

    for (const [network, list] of byNetwork.entries()) {
      await this.redis.set(KEYS.byNetwork(network), list, this.ttl);
    }

    // 5. Populate per-contract keys.
    for (const item of all) {
      await this.redis.set(
        KEYS.byNetworkAndName(item.network, item.contractName),
        item,
        this.ttl,
      );
      await this.redis.set(KEYS.byContractId(item.contractId), item, this.ttl);
    }

    const refreshedAt = new Date();

    this.logger.log(
      `contract-config cache warmed: ${all.length} contract(s), ${byNetwork.size} network(s)`,
    );

    return {
      refreshedAt,
      contractCount: all.length,
      networkCount: byNetwork.size,
    };
  }

  private async sleep(delayMs: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  private mapToResponse(metadata: any): DeploymentMetadataResponseDto {
    return {
      id: metadata.id,
      contractName: metadata.contractName,
      network: metadata.network,
      contractId: metadata.contractId,
      wasmHash: metadata.wasmHash,
      deployedAt: metadata.deployedAt,
      commitSha: metadata.commitSha ?? undefined,
      deployer: metadata.deployer ?? undefined,
      transactionHash: metadata.transactionHash ?? undefined,
      metadata: metadata.metadata ?? undefined,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    };
  }
}
