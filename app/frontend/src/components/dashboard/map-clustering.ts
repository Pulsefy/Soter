export const MAP_TARGET_MARKERS = Number(process.env.NEXT_PUBLIC_MAP_TARGET_MARKERS) || 250;
export const MAP_CLUSTER_GRID_SIZES = {
  world: Number(process.env.NEXT_PUBLIC_MAP_GRID_WORLD) || 4.5,
  regional: Number(process.env.NEXT_PUBLIC_MAP_GRID_REGIONAL) || 2.5,
  local: Number(process.env.NEXT_PUBLIC_MAP_GRID_LOCAL) || 1.2,
  detail: Number(process.env.NEXT_PUBLIC_MAP_GRID_DETAIL) || 0.6,
};

export type AidPackagePoint = {
  id: string;
  lat: number;
  lng: number;
  amount: number | string;
  token: string;
  status: string;
};

export type Cluster = {
  id: string;
  lat: number;
  lng: number;
  points: AidPackagePoint[];
};

export type Viewport = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export function clusterPoints(
  points: AidPackagePoint[],
  zoom: number,
  viewport?: Viewport,
  maxMarkers = MAP_TARGET_MARKERS,
): Cluster[] {
  if (points.length === 0) return [];

  const visiblePoints = viewport
    ? points.filter(point =>
        point.lat >= viewport.south &&
        point.lat <= viewport.north &&
        point.lng >= viewport.west &&
        point.lng <= viewport.east,
      )
    : points;
  if (visiblePoints.length === 0) return [];

  const baseGridSize =
    zoom >= 7
      ? MAP_CLUSTER_GRID_SIZES.detail
      : zoom >= 5
        ? MAP_CLUSTER_GRID_SIZES.local
        : zoom >= 3
          ? MAP_CLUSTER_GRID_SIZES.regional
          : MAP_CLUSTER_GRID_SIZES.world;
  let gridSize = baseGridSize;
  let buckets = new Map<string, AidPackagePoint[]>();

  do {
    buckets = new Map<string, AidPackagePoint[]>();
    visiblePoints.forEach(point => {
      const keyLat = Math.round(point.lat / gridSize);
      const keyLng = Math.round(point.lng / gridSize);
      const key = `${keyLat}|${keyLng}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(point);
      else buckets.set(key, [point]);
    });
    if (buckets.size <= maxMarkers || gridSize >= 180) break;
    gridSize *= 1.5;
  } while (true);

  return Array.from(buckets.entries()).map(([key, group]) => {
    const lat = group.reduce((sum, item) => sum + item.lat, 0) / group.length;
    const lng = group.reduce((sum, item) => sum + item.lng, 0) / group.length;
    return { id: `cluster-${key}`, lat, lng, points: group };
  });
}