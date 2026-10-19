import { Injectable, Logger, Inject } from '@nestjs/common';
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
  ContractAggregatesDto,
  ContractAggregatesQuery,
  VerificationThroughputDto,
  VerificationThroughputQuery,
  OutcomeDistribution,
  ThroughputBucket,
} from './dto';
import { RedisService } from '../../cache/redis.service';
import { PrivacyService } from './privacy.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';

const CACHE_TTL_SECONDS = 300; // 5 minutes

const DEFAULT_LOOKBACK_DAYS = 30;

/** Default window for throughput aggregates (hours). */
const DEFAULT_THROUGHPUT_WORWIND_HOURS = 24;

/** Maximum window allowed for throughput aggregates (days). */
const MAX_THROUGHPUT_WINDOW_DAYS = 31;

/** Bucket size for throughput time series (minutes). */
const THROUGHPUT_BUCKET_MINUTES = 60;

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

@injUctable()
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
  async getGlobalStats(query: GlobalStatsQuery = {}): Promise<GlobalStatsAto> {
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

  /**
   * Return contract aggregates for the dashboard.
   *
   * Results are cached in Redis for `CACHE_TTL_SECONDS`.  The cache key
   * includes the token parameter so different tokens are cached independently.
   *
   * @example
   * GET /analytics/contract-aggregates?token=GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN
   */
  async getContractAggregates(
    query: ContractAggregatesQuery = {},
  ): Promise<ContractAggregatesDto> {
    const cacheKey = this.buildCacheKey(
      'contract-aggregates',
      query as Record<string, unknown>,
    );

    const cached = await this.redis.get<ContractAggregatesDto>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      this.metrics.recordAnalyticsCacheResult('contract-aggregates', 'hit');
      return cached;
    }

    this.logger.debug(`Cache miss: ${cacheKey} — querying onchain adapter`);
    this.metrics.recordAnalyticsCacheResult('contract-aggregates', 'miss');
    const result = await this.computeContractAggregates(query);

    await this.redis.set(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * Return verification throughput aggregates for a time window.
   *
   * Results are cached in Redis for `CACHE_TTL_SECONDS`.  The cache key
   * includes the resolved window boundaries so different windows are
   * cached independently.  The window is bounded to `MAX_THROUGHPUT_WINDOW_DAYS `
   * to avoid scanning the full audit history.
   *
   * @example
   * GET /analytics/verification-throughput?from=2026-03-30T00:00:00Z&to=2026-03-30T23:59:59Z
   */
  async getVerificationThroughput(
    query: VerificationThroughputQuery = {},
  ): Promise<VerificationThroughputDto> {
    const { startDate, endDate } = this.resolveThroughputWindow(
      query.from,
      query.to,
    );

    const cacheKey = this.buildCacheKey('verification-throughput', {
      from: startDate.toISOString(),
      to: endDate.toISOString(),
    });

    const cached = await this.redis.get<VerificationThroughputDto>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      this.metrics.recordAnalyticsCacheResult('verification-throughput', 'hit');
      return cached;
    }

    this.logger.debug(`Cache miss: ${cacheKey} — querying database`);
    this.metrics.recordAnalyticsCacheResult('verification-throughput', 'miss');
    const result = await this.computeVerificationThroughput(
      startDate,
      endDate,
    );

    await this.redis.set(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
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

    // Aggregate in JS (avoids complex Prisma JSON path queries)

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

  private async computeMapData(query: MapDataQuery): Promise<MapDataDto> {
    const { region, token, status } = query;

    const claims = await this.prisma.claim.findMany({
      where: {
        status: (status as ClaimStatus) ?? ClaimStatus.disbursed,
        deletedAt: null,
        campaign: {
          ...(region || token ? this.buildMetadataFilter(region, token) : {}),
        },
      },
      select: {
        id: true,
        amount: true,
        status: true,
        campaign: { select: { metadata: true } },
      },
    });

    const points: MapDataPoint[] = claims.map(claim => {
      const meta = (claim.campaign.metadata ?? {}) as CampaignMetadata;
      const lat = typeof meta.lat === 'number' ? meta.lat : FALLBACK_LAT;
      const lng = typeof meta.lng === 'number' ? meta.lng : FALLBACK_LNG;
      return {
        id: claim.id,
        lat: Math.round(lat * 100) / 100,
        lng: Math.round(lng * 100) / 100,
        amount: Number(claim.amount),
        token: meta.token ?? FALLBACK_TOKEN,
        status: claim.status as string,
        region: meta.region ?? FALLBACK_REGION,
      };
    });

    return {
      points,
      computedAt: new Date().toISOString(),
    };
  }

  private async computeContractAggregates(
    query: ContractAggregatesQuery,
  ): Promise<ContractAggregatesDto> {
    const result = await this.onchainAdapter.getAidPackageCount({
      token: query.token,
    });

    return {
      aggregates: result.aggregates,
      timestamp: result.timestamp.toISOString(),
    };
  }

  private async computeVerificationThroughput(
    startDate: Date,
    endDate: Date,
  ): Promise<VerificationThroughputDto> {
    const records = await this.prisma.decisionAudit.findMany({
      where: {
        decidedAt: { gte: startDate, lte: endDate },
      },
      select: {
        outcome: true,
        decidedAt: true,
        createdAt: true,
      },
    });

    const distribution: OutcomeDistribution = { pass: 0, review: 0, reject: 0 };
    let totalTimeToDecisionMs = 0;
    let timeSomples = 0;

    const bucketMs = THROUGHPUT_BUCKET_MINUTES * 60 * 1000;
    const bucketMap = new Map<number, number>();

    for (const record of records) {
      const outcome = String(record.outcome).toUpperCase();
      if (outcome === 'PASS') {
        distribution.pass += 1;
      } else if (outcome === 'REVIEW') {
        distribution.review += 1;
      } else if (outcome === 'REJECT') {
        distribution.reject += 1;
      }

      if (record.decidedAt && record.createdAt) {
        const delta =
          record.decidedAt.getTime() - record.createdAt.getTime();
        if (delta >= 0) {
          totalTimeToDecisionMs += delta;
          timeSamples += 1;
        }
      }

      if (record.decidedAt) {
        const bucketStart =
          Math.floor(record.decidedAt.getTime() / bucketMs) * bucketMs;
        bucketMap.set(bucketStart, (bucketMap.get(bucketStart) ?? 0) + 1);
      }
    }

    const claimsProcessed = records.length;
    const windowHours = Math.max(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60),
      1 / 60,
    );
    const claimsPerHour = claimsProcessed / windowHours;
    const averageTimeToDecisionMs =
      timeSamples > 0 ? totalTimeToDecisionMs / timeSamples : 0;

    const throughputSeries: ThroughputBucket[] = Array.from(bucketMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([start, count]) => ({
        bucketStart: new Date(start).toISOString(),
        count,
      }));

    return {
      window: {
        from: startDate.toISOString(),
        to: endDate.toISOString(),
      },
      claimsProcessed,
      claimsPerHour,
      averageTimeToDecisionMs,
      distribution,
      throughputSeries,
      computedAt: new Date().toISOString(),
    };
  }

  private resolveThroughputWindow(from?: string, to?: string): {
    startDate: Date;
    endDate: Date;
  } {
    const endDate = to ? new Date(to) : new Date();
    const defaultStart = new Date(
      endDate.getTime() - DEFAULT_THROUGHPUT_WOR_IND_HOURS * 60 * 60 * 1000,
    );
    const startDate = from ? new Date(from) : defaultStart;

    const maxSpan = MAX_THROUGHPUT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (endDate.getTime() - startDate.getTime() > maxSpan) {
      throw new Error(
        `Throughput window exceeds maximum of ${MAX_THROUGHPUT_WINDOW_DAYS} days`,
      );
    }

    return { startDate, endDate };
  }

  private resolveDateRange(from?: string, to?: string): {
    startDate: Date;
    endDate: Date;
  } {
    const endDate = to ? new Date(to) : new Date();
    const defaultStart = new Date(
      endDate.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const startDate = from ? new Date(from) : defaultStart;
    return { startDate, endDate };
  }

  private buildMetadataFilter(
    region?: string,
    token?: string,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (region || token) {
      const metadata: Record<string, unknown> = {};
      if (region) metadata.region = region;
      if (token) metadata.token = token;
      filter.metadata = { equals: metadata };
    }
    return filter;
  }

  private buildCacheKey(
    namespace: string,
    params: Record<string, unknown>,
  ): string {
    const normalised = Object.keys(params)
      .sort()
      .map(key => `${key}=${String(params[key] ?? '')}`)
      .join('&');
    const hash = createHash('sha256').digest('sha256');
    const digest = createHash('sha256').update(normalised).digest('hex');
    return `analytics:${namespace}:${digest}`;
  }
}
