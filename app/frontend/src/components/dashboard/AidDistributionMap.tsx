"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { fetchClient } from '@/lib/mock-api/client';

const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

const STATUS_STYLES: Record<string, string> = {
  delivered: 'aid-marker--delivered',
  pending: 'aid-marker--pending',
  in_transit: 'aid-marker--in-transit',
  intransit: 'aid-marker--in-transit',
  failed: 'aid-marker--failed',
  cancelled: 'aid-marker--failed',
};

type AidPackagePoint = {
  id: string;
  lat: number;
  lng: number;
  amount: number | string;
  token: string;
  status: string;
};

type Cluster = {
  id: string;
  lat: number;
  lng: number;
  points: AidPackagePoint[];
};

function normalizePoint(input: any, index: number): AidPackagePoint | null {
  const lat = Number(input?.lat ?? input?.latitude);
  const lng = Number(input?.lng ?? input?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    id: String(input?.id ?? input?.packageId ?? `pkg-${index}`),
    lat,
    lng,
    amount: input?.amount ?? input?.value ?? '—',
    token: String(input?.token ?? input?.asset ?? 'N/A'),
    status: String(input?.status ?? 'Unknown'),
  };
}

function clusterPoints(points: AidPackagePoint[], zoom: number): Cluster[] {
  if (points.length === 0) return [];

  const gridSize = zoom >= 7 ? 0.6 : zoom >= 5 ? 1.2 : zoom >= 3 ? 2.5 : 4.5;
  const buckets = new Map<string, AidPackagePoint[]>();

  points.forEach(point => {
    const keyLat = Math.round(point.lat / gridSize);
    const keyLng = Math.round(point.lng / gridSize);
    const key = `${keyLat}|${keyLng}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(point);
    } else {
      buckets.set(key, [point]);
    }
  });

  return Array.from(buckets.entries()).map(([key, group]) => {
    const lat = group.reduce((sum, item) => sum + item.lat, 0) / group.length;
    const lng = group.reduce((sum, item) => sum + item.lng, 0) / group.length;
    return {
      id: `cluster-${key}`,
      lat,
      lng,
      points: group,
    };
  });
}

function formatStatus(status: string) {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, value => value.toUpperCase());
}

function createMarkerIcon({ count, status }: { count?: number; status?: string }) {
  if (count && count > 1) {
    return L.divIcon({
      className: 'aid-marker aid-marker--cluster',
      html: `<span>${count}</span>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -18],
    });
  }

  const normalizedStatus = String(status ?? '').toLowerCase().replace(/\s/g, '_');
  const statusClass = STATUS_STYLES[normalizedStatus] ?? 'aid-marker--default';

  return L.divIcon({
    className: `aid-marker ${statusClass}`,
    html: '<span></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => {
      onZoom(map.getZoom());
    },
  });

  return null;
}

export default function AidDistributionMap() {
  const [points, setPoints] = useState<AidPackagePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        setLoading(true);
        const response = await fetchClient(`${API_URL}/analytics/map-data`);
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }
        const payload = await response.json();
        const rawPoints = Array.isArray(payload) ? payload : payload?.data ?? [];
        const normalized = rawPoints
          .map(normalizePoint)
          .filter((item): item is AidPackagePoint => Boolean(item));

        if (active) {
          setPoints(normalized);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError('Unable to load live distribution data.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = () => {
      const hasDarkClass = document.documentElement.classList.contains('dark');
      setIsDark(hasDarkClass || media.matches);
    };

    updateTheme();
    media.addEventListener('change', updateTheme);

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      media.removeEventListener('change', updateTheme);
      observer.disconnect();
    };
  }, []);

  const clusters = useMemo(() => clusterPoints(points, zoom), [points, zoom]);
  const tileConfig = useMemo(
    () =>
      isDark
        ? {
            url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          }
        : {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
    [isDark]
  );

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/90 dark:bg-gray-950/70 shadow-xl overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-xl font-semibold">Global Aid Distribution</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Live map of anonymized aid packages delivered around the world.
        </p>
      </div>
      <div className="relative h-[420px] md:h-[520px]">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom
          className="aid-map"
        >
          <TileLayer url={tileConfig.url} attribution={tileConfig.attribution} />
          <ZoomWatcher onZoom={setZoom} />
          {clusters.map(cluster => {
            const icon = createMarkerIcon({
              count: cluster.points.length,
              status: cluster.points[0]?.status,
            });

            return (
              <Marker key={cluster.id} position={[cluster.lat, cluster.lng]} icon={icon}>
                <Popup className="aid-popup">
                  {cluster.points.length > 1 ? (
                    <div className="space-y-3">
                      <p className="text-sm font-semibold">{cluster.points.length} packages</p>
                      <div className="space-y-2">
                        {cluster.points.slice(0, 5).map(point => (
                          <div key={point.id} className="text-xs">
                            <p className="font-medium">
                              {point.amount} {point.token}
                            </p>
                            <p className="text-gray-600">{formatStatus(point.status)}</p>
                          </div>
                        ))}
                        {cluster.points.length > 5 && (
                          <p className="text-xs text-gray-500">
                            +{cluster.points.length - 5} more packages
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Package Details</p>
                      <div className="text-xs space-y-1">
                        <p>
                          <span className="font-medium">Amount:</span> {cluster.points[0].amount}
                        </p>
                        <p>
                          <span className="font-medium">Token:</span> {cluster.points[0].token}
                        </p>
                        <p>
                          <span className="font-medium">Status:</span>{' '}
                          {formatStatus(cluster.points[0].status)}
                        </p>
                      </div>
                    </div>
                  )}
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-gray-950/70 text-sm text-gray-600 dark:text-gray-300">
            Loading live map data…
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-gray-950/70 text-sm text-red-600">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
