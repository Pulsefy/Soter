"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { fetchClient } from '@/lib/mock-api/client';
import { getAppUserRole, isOperationsRole } from '@/lib/app-role';

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

function normalizePoint(input: unknown, index: number): AidPackagePoint | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const point = input as Record<string, unknown>;
  const lat = Number(point.lat ?? point.latitude);
  const lng = Number(point.lng ?? point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    id: String(point.id ?? point.packageId ?? `pkg-${index}`),
    lat,
    lng,
    amount:
      typeof point.amount === 'number' || typeof point.amount === 'string'
        ? point.amount
        : typeof point.value === 'number' || typeof point.value === 'string'
          ? point.value
          : '—',
    token: String(point.token ?? point.asset ?? 'N/A'),
    status: String(point.status ?? 'Unknown'),
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
  const role = getAppUserRole();
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
        const payload: unknown = await response.json();
        const rawPoints = Array.isArray(payload)
          ? payload
          : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
            ? (payload as { data: unknown[] }).data
            : [];
        const normalized = rawPoints
          .map(normalizePoint)
          .filter((item): item is AidPackagePoint => Boolean(item));

        if (active) {
          setPoints(normalized);
          setError(null);
        }
      } catch {
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
        {!loading && !error && points.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 px-6 text-center dark:bg-gray-950/80">
            <div className="max-w-xl space-y-3">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Empty Map
              </p>
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
                {isOperationsRole(role) ? 'No distribution points are available yet' : 'No live distribution activity is available yet'}
              </h3>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                {isOperationsRole(role)
                  ? 'Create sample campaign data or enable mocks to populate the map and test cluster, popup, and filter behaviour.'
                  : 'This map becomes active once aid package data is available. In the meantime, you can explore verification and dashboard flows with sample guidance.'}
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link href={isOperationsRole(role) ? '/campaigns' : '/'} className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
                  {isOperationsRole(role) ? 'Create sample campaign' : 'Open verification flow'}
                </Link>
                <Link href="/help" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                  View help
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
