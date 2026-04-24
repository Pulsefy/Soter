import { Injectable, Logger } from '@nestjs/common';
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
} from './dto';
import { RedisService } from '../../cache/redis.service';
import { PrivacyService } from './privacy.service';

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

const ANALYTICS_CACHE_PREFIX = 'analytics';
const ANALYTICS_CACHE_PATTERN = `${ANALYTICS_CACHE_PREFIX}:*`;

const CACHE_TTL_SECONDS = 300; // 5 minutes

const DEFAULT_LOOKBACK_DAYS = 30;

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

  private cacheHits = 0;
  private cacheMisses = 0;
  private cacheInvalidations = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly privacyService: PrivacyService,
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
      'global-stats',
      query as Record<string, unknown>,
    );

    return this.getOrSetCache(cacheKey, () => this.computeGlobalStats(query));
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

    return this.getOrSetCache(cacheKey, () => this.computeMapData(query));
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

  async invalidateAnalyticsCache(reason = 'analytics dependency changed') {
    const keys = await this.redis.scanKeys(ANALYTICS_CACHE_PATTERN);

    if (!keys.length) {
      this.logger.debug(
        `No analytics cache keys found to invalidate: ${reason}`,
      );
      return { deletedKeys: 0, reason };
    }

    await this.redis.del(keys);
    this.cacheInvalidations += 1;

    this.logger.log(
      `Invalidated ${keys.length} analytics cache key(s): ${reason}`,
    );

    return { deletedKeys: keys.length, reason };
  }

  getCacheMetrics() {
    const totalRequests = this.cacheHits + this.cacheMisses;

    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      invalidations: this.cacheInvalidations,
      totalRequests,
      hitRate: totalRequests === 0 ? 0 : this.cacheHits / totalRequests,
      ttlSeconds: CACHE_TTL_SECONDS,
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

    // Count active campaigns (optionally filtered by region / token).
    const activeCampaigns = await this.prisma.campaign.count({
      where: {
        status: 'active',
        ...(region || token ? this.buildMetadataFilter(region, token) : {}),
      },
    });

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

  private async getOrSetCache<T>(
    cacheKey: string,
    compute: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.redis.get<T>(cacheKey);

    if (cached) {
      this.cacheHits += 1;
      this.logger.debug(`Analytics cache hit: ${cacheKey}`);
      return cached;
    }

    this.cacheMisses += 1;
    this.logger.debug(`Analytics cache miss: ${cacheKey}`);

    const result = await compute();

    await this.redis.set(cacheKey, result, CACHE_TTL_SECONDS);

    return result;
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

    return `${ANALYTICS_CACHE_PREFIX}:${endpoint}${sorted ? ':' + sorted : ''}`;
  }

  private anonymiseId(id: string): string {
    return createHash('sha256').update(id).digest('hex').slice(0, 12);
  }

  private truncate2dp(n: number): number {
    return Math.trunc(n * 100) / 100;
  }
}
