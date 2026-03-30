export interface BreakdownEntry {
  label: string;
  totalAmount: number;
  count: number;
}

export interface TimeframeBucket {
  date: string;
  totalAmount: number;
  count: number;
}

export interface GlobalStatsDto {
  totalAidDisbursed: number;
  totalRecipients: number;
  activeCampaigns: number;
  byToken: BreakdownEntry[];
  byRegion: BreakdownEntry[];
  timeSeries: TimeframeBucket[];
  computedAt: string;
}

export interface MapDataPoint {
  id: string;
  lat: number;
  lng: number;
  amount: number;
  token: string;
  status: string;
  region: string;
}

export interface MapDataDto {
  points: MapDataPoint[];
  computedAt: string;
}

export interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: Omit<MapDataPoint, 'lat' | 'lng'>;
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
  computedAt: string;
}

export interface GlobalStatsQuery {
  from?: string;
  to?: string;
  region?: string;
  token?: string;
}

export interface MapDataQuery {
  region?: string;
  token?: string;
  status?: string;
}
