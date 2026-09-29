import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BreakdownEntry {
  @ApiProperty({ example: 'USDC' })
  label: string;

  @ApiProperty({ example: 1500.5 })
  totalAmount: number;

  @ApiProperty({ example: 45 })
  count: number;
}

export class TimeframeBucket {
  @ApiProperty({ example: '2026-03-01' })
  date: string;

  @ApiProperty({ example: 500 })
  totalAmount: number;

  @ApiProperty({ example: 10 })
  count: number;
}

export class GlobalStatsDto {
  @ApiProperty({ example: 142 })
  totalClaims: number;

  @ApiProperty({ example: 48 })
  totalPackages: number;

  @ApiProperty({ example: 9 })
  pendingReviews: number;

  @ApiProperty({ example: 76 })
  totalDisbursements: number;

  @ApiProperty({ example: 250000 })
  totalAidDisbursed: number;

  @ApiProperty({ example: 1250 })
  totalRecipients: number;

  @ApiProperty({ example: 12 })
  activeCampaigns: number;

  @ApiProperty({ type: [BreakdownEntry] })
  byToken: BreakdownEntry[];

  @ApiProperty({ type: [BreakdownEntry] })
  byRegion: BreakdownEntry[];

  @ApiProperty({ type: [TimeframeBucket] })
  timeSeries: TimeframeBucket[];

  @ApiProperty({ example: '2026-03-30T10:00:00Z' })
  computedAt: string;
}

export class OnchainAggregatesDto {
  @ApiProperty({
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
  })
  tokenAddress: string;

  @ApiProperty({
    example: '5000000000',
    description: 'Funds currently locked (packages still in Created status).',
  })
  totalLocked: string;

  @ApiProperty({
    example: '2000000000',
    description:
      'Funds claimed (packages in Claimed status, including disbursements).',
  })
  totalClaimed: string;

  @ApiProperty({
    example: '500000000',
    description: 'Funds released (Expired, Cancelled, or Refunded packages).',
  })
  totalExpiredCancelled: string;

  @ApiProperty({ example: '2026-03-30T10:00:00Z' })
  fetchedAt: string;

  @ApiProperty({
    example: false,
    description: 'Whether these aggregates were served from cache.',
  })
  cached: boolean;
}

export class DivergenceFieldDto {
  @ApiProperty({ example: 'totalDisbursed' })
  field: string;

  @ApiProperty({ example: 250000 })
  database: number;

  @ApiProperty({ example: 250000 })
  onchain: number;

  @ApiProperty({ example: 0 })
  delta: number;

  @ApiProperty({ example: false })
  divergent: boolean;
}

export class DivergenceReportDto {
  @ApiProperty({ example: false })
  hasDivergence: boolean;

  @ApiProperty({ example: 0.01 })
  tolerance: number;

  @ApiProperty({ type: [DivergenceFieldDto] })
  fields: DivergenceFieldDto[];
}

export class OnchainSummaryDto {
  @ApiProperty({
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
  })
  token: string;

  @ApiProperty({ type: GlobalStatsDto })
  summary: GlobalStatsDto;

  @ApiProperty({ type: OnchainAggregatesDto })
  onchain: OnchainAggregatesDto;

  @ApiProperty({ type: DivergenceReportDto })
  divergence: DivergenceReportDto;

  @ApiProperty({ example: '2026-03-30T10:00:00Z' })
  computedAt: string;
}

export class OnchainSummaryQuery {
  @ApiPropertyOptional({
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
    description:
      'Token (Stellar Asset Contract) address to read aggregates for.',
  })
  token?: string;
}

export class MapDataPoint {
  @ApiProperty({ example: 'pkg-123' })
  id: string;

  @ApiProperty({ example: 6.5244 })
  lat: number;

  @ApiProperty({ example: 3.3792 })
  lng: number;

  @ApiProperty({ example: 100 })
  amount: number;

  @ApiProperty({ example: 'USDC' })
  token: string;

  @ApiProperty({ example: 'delivered' })
  status: string;

  @ApiProperty({ example: 'Lagos' })
  region: string;
}

export class MapDataDto {
  @ApiProperty({ type: [MapDataPoint] })
  points: MapDataPoint[];

  @ApiProperty({ example: '2026-03-30T10:00:00Z' })
  computedAt: string;
}

export class GeoJsonFeature {
  @ApiProperty({ example: 'Feature' })
  type: 'Feature';

  @ApiProperty({
    example: {
      type: 'Point',
      coordinates: [3.3792, 6.5244],
    },
  })
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };

  @ApiProperty()
  properties: Omit<MapDataPoint, 'lat' | 'lng'>;
}

export class GeoJsonFeatureCollection {
  @ApiProperty({ example: 'FeatureCollection' })
  type: 'FeatureCollection';

  @ApiProperty({ type: [GeoJsonFeature] })
  features: GeoJsonFeature[];

  @ApiProperty({ example: '2026-03-30T10:00:00Z' })
  computedAt: string;
}

export class GlobalStatsQuery {
  @ApiPropertyOptional({ example: '2026-01-01' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-03-30' })
  to?: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  region?: string;

  @ApiPropertyOptional({ example: 'USDC' })
  token?: string;
}

export class MapDataQuery {
  @ApiPropertyOptional({ example: 'Lagos' })
  region?: string;

  @ApiPropertyOptional({ example: 'USDC' })
  token?: string;

  @ApiPropertyOptional({ example: 'delivered' })
  status?: string;
}
