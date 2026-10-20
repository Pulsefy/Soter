import type { Gauge, Histogram } from 'prom-client';
import { performance } from 'node:perf_hooks';
import type { Pool, PoolClient } from 'pg';

type PoolConnectCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  release: PoolClient['release'],
) => void;

export interface PrismaPoolMetrics {
  size: Gauge<string>;
  connectionsInUse: Gauge<string>;
  waitingConnections: Gauge<string>;
  waitDuration: Histogram<string>;
}

export function monitorPrismaPool(
  pool: Pool,
  metrics: PrismaPoolMetrics,
): void {
  const updateGauges = () => {
    metrics.size.set(pool.options.max ?? 10);
    metrics.connectionsInUse.set(pool.totalCount - pool.idleCount);
    metrics.waitingConnections.set(pool.waitingCount);
  };

  const originalConnect = pool.connect.bind(pool);
  pool.connect = ((callback?: PoolConnectCallback) => {
    const queued =
      pool.waitingCount > 0 ||
      (pool.totalCount >= (pool.options.max ?? 10) && pool.idleCount === 0);
    const queuedAt = performance.now();
    const recordWait = () => {
      if (queued) {
        metrics.waitDuration.observe((performance.now() - queuedAt) / 1000);
      }
      updateGauges();
    };

    const result = callback
      ? originalConnect((error, client, release) => {
          if (!error) {
            recordWait();
          } else {
            updateGauges();
          }
          callback(error, client, release);
        })
      : originalConnect().then(client => {
          recordWait();
          return client;
        });

    updateGauges();
    return result;
  }) as Pool['connect'];

  pool.on('connect', updateGauges);
  pool.on('acquire', updateGauges);
  pool.on('release', updateGauges);
  pool.on('remove', updateGauges);
  updateGauges();
}
