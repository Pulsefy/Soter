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
