import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ClaimStatus } from '@prisma/client';
import {
  GlobalStatsDto,
  GlobalStatsQuery,
  MapDataDto,
  MapDataPoint,
  MapDataQuery,
  BreakdownEntry,
  TimeframeBucket,
  GeoJsonFeatureCollection,
  DivergenceFieldDto,
  OnchainAggregatesDto,
  OnchainSummaryDto,
  OnchainSummaryQuery,
} from './dto';
import { RedisService } from '../../cache/redis.service';
import { PrivacyService } from './privacy.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';
import { getCacheTTL } from '../common/config/cache.config';
import { AppException, ERROR_CODES } from '../common/dto/error-response.dto';

// export type MapDataPoint = {
//   id: string;
//   lat: number;
//   lng: number;
//   amount: number;
//   token: string;
//   status: string;
// };

// @Injectable()
// export class AnalyticsService {
//   getMapData(): MapDataPoint[] {
//     return [
//       {
//         id: 'pkg-001',
//         lat: 6.5244,
//         lng: 3.3792,
//         amount: 250,
//         token: 'USDC',
//         status: 'delivered',
//       },
//       {
//         id: 'pkg-002',
//         lat: 9.0765,
//         lng: 7.3986,
//         amount: 120,
//         token: 'USDC',
//         status: 'pending',
//       },
//       {
//         id: 'pkg-003',
//         lat: -1.286389,
//         lng: 36.817223,
//         amount: 560,
//         token: 'XLM',
//         status: 'in_transit',
//       },
//       {
//         id: 'pkg-004',
//         lat: 14.716677,
//         lng: -17.467686,
//         amount: 90,
//         token: 'USDC',
//         status: 'delivered',
//       },
//       {
//         id: 'pkg-005',
//         lat: -26.204103,
//         lng: 28.047305,
//         amount: 310,
//         token: 'XLM',
//         status: 'delivered',
//       },
//     ];
//   }

// }

const CACHE_TTL_SECONDS = 300; // 5 minutes

const DEFAULT_LOOKBACK_DAYS = 30;

/** Namespace for the cached, direct-from-contract token aggregates. */
const ONCHAIN_AGGREGATES_CACHE_PREFIX = 'analytics:onchain-aggregates';

/** Metric/endpoint label used for the on-chain aggregates cache. */
const ONCHAIN_AGGREGATES_CACHE_ENDPOINT = 'onchain-aggregates';

/**
 * Stellar Asset Contracts use 7 decimal places by default, so a contract
 * amount of `2500000000` base units is `250` display units. Kept configurable
 * because a token issuer can pick a different precision.
 */
const DEFAULT_TOKEN_DECIMALS = 7;

/**
 * Absolute difference (in display units) tolerated before the database-derived
 * and on-chain totals are considered divergent. Small so real drift is caught,
 * non-zero so rounding in the database side does not raise false positives.
 */
const DEFAULT_DIVERGENCE_TOLERANCE = 0.01;

/** Fallback values when campaign metadata fields are absent. */
const FALLBACK_REGION = 'Unknown';
const FALLBACK_TOKEN = 'UNKNOWN';
const FALLBACK_LAT = 0;
const FALLBACK_LNG = 0;

interface CampaignMetadata {
  region?: string;
  token?: string;
  lat?: number;
  lng?: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly privacyService: PrivacyService,
    private readonly metrics: MetricsService,
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
  ) {}

  /**
   * Return aggregated totals for the global dashboard.
   *
   * Results are cached in Redis for `CACHE_TTL_SECONDS`.  The cache key
   * includes every query parameter so different filter combinations are
   * cached independently.
   *
   * @example
   * GET /analytics/global-stats?from=2024-01-01&to=2024-03-31&token=USDC
   */
  async getGlobalStats(query: GlobalStatsQuery = {}): Promise<GlobalStatsDto> {
    const cacheKey = this.buildCacheKey(
      'global-stats-v2',
      query as Record<string, unknown>,
    );

    const cached = await this.redis.get<GlobalStatsDto>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      this.metrics.recordAnalyticsCacheResult('global-stats', 'hit');
      return cached;
    }

    this.logger.debug(`Cache miss: ${cacheKey} — querying database`);
    this.metrics.recordAnalyticsCacheResult('global-stats', 'miss');
    const result = await this.computeGlobalStats(query);

    await this.redis.set(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * Return anonymised geo-coordinates of disbursements for the Leaflet map.
   *
   * Only claims with status `disbursed` are included.  Coordinates are
   * derived from the parent campaign's metadata centroid and truncated to
   * 2 decimal places before being returned.
   *
   * @example
   * GET /analytics/map-data?region=West+Africa&token=USDC
   */
  async getMapData(query: MapDataQuery = {}): Promise<MapDataDto> {
    const cacheKey = this.buildCacheKey(
      'map-data',
      query as Record<string, unknown>,
    );

    const cached = await this.redis.get<MapDataDto>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      this.metrics.recordAnalyticsCacheResult('map-data', 'hit');
      return cached;
    }

    this.logger.debug(`Cache miss: ${cacheKey} — querying database`);
    this.metrics.recordAnalyticsCacheResult('map-data', 'miss');
    const result = await this.computeMapData(query);

    await this.redis.set(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * Return the existing database-derived dashboard summary alongside the
   * on-chain aggregates for a token, flagging any divergence between the two.
   *
   * The database summary keeps describing the off-chain operational workload;
   * the on-chain block is the contract's authoritative view. The on-chain read
   * is cached (see {@link getOnchainAggregates}) so a dashboard load cannot
   * turn into a Soroban RPC call every time.
   *
   * @example
   * GET /analytics/onchain-summary?token=GATEMH...
   */
  async getOnchainSummary(
    query: OnchainSummaryQuery = {},
  ): Promise<OnchainSummaryDto> {
    const token = query.token?.trim();
    if (!token) {
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        'A token address is required to read on-chain aggregates.',
      );
    }

    const [summary, onchain] = await Promise.all([
      this.getGlobalStats({}),
      this.getOnchainAggregates(token),
    ]);

    const tolerance = this.divergenceTolerance();
    const decimals = this.tokenDecimals();
    const fields: DivergenceFieldDto[] = [
      this.buildDivergenceField(
        'totalDisbursed',
        summary.totalAidDisbursed,
        this.fromBaseUnits(onchain.totalClaimed, decimals),
        tolerance,
      ),
    ];

    const hasDivergence = fields.some(field => field.divergent);
    if (hasDivergence) {
      this.logger.warn(
        `On-chain aggregate divergence for token ${token}: ` +
          fields
            .filter(field => field.divergent)
            .map(
              field =>
                `${field.field} database=${field.database} onchain=${field.onchain} delta=${field.delta}`,
            )
            .join(', '),
      );
    }

    return {
      token,
      summary,
      onchain,
      divergence: { hasDivergence, tolerance, fields },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Read the contract's aggregates for a token, cached in Redis so the RPC
   * endpoint is hit at most once per cache window regardless of how many
   * dashboards are open.
   */
  private async getOnchainAggregates(
    token: string,
  ): Promise<OnchainAggregatesDto> {
    const cacheKey = `${ONCHAIN_AGGREGATES_CACHE_PREFIX}:${token}`;

    const cached = await this.redis.get<OnchainAggregatesDto>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      this.metrics.recordAnalyticsCacheResult(
        ONCHAIN_AGGREGATES_CACHE_ENDPOINT,
        'hit',
      );
      return { ...cached, cached: true };
    }

    this.logger.debug(`Cache miss: ${cacheKey} — reading Soroban RPC`);
    this.metrics.recordAnalyticsCacheResult(
      ONCHAIN_AGGREGATES_CACHE_ENDPOINT,
      'miss',
    );

    const result = await this.onchainAdapter.getAggregates(token);
    const value: OnchainAggregatesDto = {
      tokenAddress: result.tokenAddress,
      totalLocked: result.aggregates.totalCommitted,
      totalClaimed: result.aggregates.totalClaimed,
      totalExpiredCancelled: result.aggregates.totalExpiredCancelled,
      fetchedAt: result.timestamp.toISOString(),
      cached: false,
    };

    await this.redis.set(cacheKey, value, getCacheTTL().ONCHAIN_AGGREGATES);
    return value;
  }

  /** Convert a base-unit (stroop) amount string to display units. */
  private fromBaseUnits(amount: string, decimals: number): number {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed)) return 0;
    return parsed / Math.pow(10, decimals);
  }

  private tokenDecimals(): number {
    const raw = parseInt(process.env.SOROBAN_TOKEN_DECIMALS ?? '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TOKEN_DECIMALS;
  }

  private divergenceTolerance(): number {
    const raw = parseFloat(
      process.env.ONCHAIN_AGGREGATES_DIVERGENCE_TOLERANCE ?? '',
    );
    return Number.isFinite(raw) && raw >= 0
      ? raw
      : DEFAULT_DIVERGENCE_TOLERANCE;
  }

  private buildDivergenceField(
    field: string,
    database: number,
    onchain: number,
    tolerance: number,
  ): DivergenceFieldDto {
    const delta = Math.round((database - onchain) * 100) / 100;
    return {
      field,
      database,
      onchain,
      delta,
      divergent: Math.abs(delta) > tolerance,
    };
  }

  /**
   * Invalidate all analytics cache entries.
   *
   * Should be called whenever campaigns or claims change state so that the
   * next request recomputes fresh data.
   *
   * @param reason - Human-readable reason for the invalidation (used in metrics).
   */
  async invalidateCache(reason: string): Promise<void> {
    const deleted = await this.redis.delByPattern('analytics:*');
    this.logger.debug(
      `Analytics cache invalidated (reason: ${reason}), ${deleted} key(s) removed`,
    );
    this.metrics.incrementAnalyticsCacheInvalidation(reason);
  }

  /**
   * Return anonymized geo-coordinates formatted as GeoJSON.
   */
  async getMapAnonymizedData(
    query: MapDataQuery = {},
  ): Promise<GeoJsonFeatureCollection> {
    const rawData = await this.getMapData(query);

    const features = rawData.points.map(p => {
      const { lat, lng } = this.privacyService.fuzzCoordinates(p.lat, p.lng);
      const { lat: _lat, lng: _lng, ...properties } = p;
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lng, lat] as [number, number],
        },
        properties,
      };
    });

    return {
      type: 'FeatureCollection',
      features,
      computedAt: rawData.computedAt,
    };
  }

  private async computeGlobalStats(
    query: GlobalStatsQuery,
  ): Promise<GlobalStatsDto> {
    const { from, to, region, token } = query;
    const { startDate, endDate } = this.resolveDateRange(from, to);

    // Fetch all disbursed claims within the time window, including their
    // parent campaign so we can read metadata.
    const claims = await this.prisma.claim.findMany({
      where: {
        status: ClaimStatus.disbursed,
        createdAt: { gte: startDate, lte: endDate },
        campaign: {
          ...(region || token ? this.buildMetadataFilter(region, token) : {}),
        },
      },
      select: {
        id: true,
        amount: true,
        recipientRef: true,
        status: true,
        createdAt: true,
        campaign: {
          select: { metadata: true },
        },
      },
    });

    // These totals are intentionally independent of the distribution filters.
    // They power the dashboard summary cards, which should describe the
    // complete operational workload rather than only the selected map slice.
    const [
      activeCampaigns,
      totalClaims,
      totalPackages,
      pendingReviews,
      totalDisbursements,
    ] = await Promise.all([
      this.prisma.campaign.count({
        where: {
          status: 'active',
          ...(region || token ? this.buildMetadataFilter(region, token) : {}),
        },
      }),
      this.prisma.claim.count({ where: { deletedAt: null } }),
      this.prisma.aidPackage.count(),
      this.prisma.verificationRequest.count({
        where: {
          deletedAt: null,
          status: { in: ['pending', 'pending_review'] },
        },
      }),
      this.prisma.claim.count({
        where: { deletedAt: null, status: ClaimStatus.disbursed },
      }),
    ]);

    //  Aggregate in JS (avoids complex Prisma JSON path queries)

    let totalAidDisbursed = 0;
    const uniqueRecipients = new Set<string>();
    const tokenMap = new Map<string, { amount: number; count: number }>();
    const regionMap = new Map<string, { amount: number; count: number }>();
    // date string (YYYY-MM-DD) → { amount, count }
    const dateMap = new Map<string, { amount: number; count: number }>();

    for (const claim of claims) {
      const meta = (claim.campaign.metadata ?? {}) as CampaignMetadata;
      const claimToken = meta.token ?? FALLBACK_TOKEN;
      const claimRegion = meta.region ?? FALLBACK_REGION;
      const claimAmount = Number(claim.amount);
      const dateKey = claim.createdAt.toISOString().slice(0, 10);

      totalAidDisbursed += claimAmount;
      uniqueRecipients.add(claim.recipientRef);

      // Token breakdown
      const tok = tokenMap.get(claimToken) ?? { amount: 0, count: 0 };
      tok.amount += claimAmount;
      tok.count += 1;
      tokenMap.set(claimToken, tok);

      // Region breakdown
      const reg = regionMap.get(claimRegion) ?? { amount: 0, count: 0 };
      reg.amount += claimAmount;
      reg.count += 1;
      regionMap.set(claimRegion, reg);

      // Daily time series
      const day = dateMap.get(dateKey) ?? { amount: 0, count: 0 };
      day.amount += claimAmount;
      day.count += 1;
      dateMap.set(dateKey, day);
    }

    const byToken: BreakdownEntry[] = Array.from(tokenMap.entries()).map(
      ([label, { amount, count }]) => ({
        label,
        totalAmount: Math.round(amount * 100) / 100,
        count,
      }),
    );

    const byRegion: BreakdownEntry[] = Array.from(regionMap.entries()).map(
      ([label, { amount, count }]) => ({
        label,
        totalAmount: Math.round(amount * 100) / 100,
        count,
      }),
    );

    const timeSeries: TimeframeBucket[] = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { amount, count }]) => ({
        date,
        totalAmount: Math.round(amount * 100) / 100,
        count,
      }));

    return {
      totalClaims,
      totalPackages,
      pendingReviews,
      totalDisbursements,
      totalAidDisbursed: Math.round(totalAidDisbursed * 100) / 100,
      totalRecipients: uniqueRecipients.size,
      activeCampaigns,
      byToken,
      byRegion,
      timeSeries,
      computedAt: new Date().toISOString(),
    };
  }

  // Private — map data computation

  private async computeMapData(query: MapDataQuery): Promise<MapDataDto> {
    const { region, token, status } = query;

    // Resolve the Prisma ClaimStatus filter.
    const claimStatus =
      status && Object.values(ClaimStatus).includes(status as ClaimStatus)
        ? (status as ClaimStatus)
        : ClaimStatus.disbursed;

    const claims = await this.prisma.claim.findMany({
      where: {
        status: claimStatus,
        campaign: {
          ...(region || token ? this.buildMetadataFilter(region, token) : {}),
        },
      },
      select: {
        id: true,
        amount: true,
        status: true,
        campaign: {
          select: { metadata: true },
        },
      },
    });

    const points: MapDataPoint[] = claims.map(claim => {
      const meta = (claim.campaign.metadata ?? {}) as CampaignMetadata;

      return {
        // Anonymise: 12-char hex prefix of SHA-256(claimId)
        id: this.anonymiseId(claim.id),
        // Truncate to 2 d.p. (~1 km resolution)
        lat: this.truncate2dp(meta.lat ?? FALLBACK_LAT),
        lng: this.truncate2dp(meta.lng ?? FALLBACK_LNG),
        amount: Number(claim.amount),
        token: meta.token ?? FALLBACK_TOKEN,
        status: claim.status,
        region: meta.region ?? FALLBACK_REGION,
      };
    });

    return { points, computedAt: new Date().toISOString() };
  }

  private buildMetadataFilter(
    region?: string,
    token?: string,
  ): Record<string, unknown> {
    const conditions: Record<string, unknown>[] = [];

    if (region) {
      conditions.push({
        metadata: {
          path: ['region'],
          equals: region,
        },
      });
    }

    if (token) {
      conditions.push({
        metadata: {
          path: ['token'],
          equals: token,
        },
      });
    }

    return conditions.length === 1 ? conditions[0] : { AND: conditions };
  }

  private resolveDateRange(
    from?: string,
    to?: string,
  ): { startDate: Date; endDate: Date } {
    const endDate = to ? new Date(to) : new Date();
    const startDate = from
      ? new Date(from)
      : new Date(
          endDate.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        );

    return { startDate, endDate };
  }

  /**
   * Build a stable, namespaced Redis cache key from an endpoint name and
   * query params.  Params are sorted so key('a=1&b=2') === key('b=2&a=1').
   *
   * Example: "analytics:global-stats:from=2024-01-01:token=USDC"
   */
  private buildCacheKey(
    endpoint: string,
    query: Record<string, unknown>,
  ): string {
    const sorted = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(':');

    return `analytics:${endpoint}${sorted ? ':' + sorted : ''}`;
  }

  private anonymiseId(id: string): string {
    return createHash('sha256').update(id).digest('hex').slice(0, 12);
  }

  private truncate2dp(n: number): number {
    return Math.trunc(n * 100) / 100;
  }
}
