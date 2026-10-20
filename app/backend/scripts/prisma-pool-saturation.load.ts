import { Gauge, Histogram, Registry } from 'prom-client';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { monitorPrismaPool } from '../src/prisma/prisma-pool-metrics';

const delay = (milliseconds: number) =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

async function runSaturationTest(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL must point to a disposable PostgreSQL database',
    );
  }

  const registry = new Registry();
  const size = new Gauge({
    name: 'test_prisma_pool_size',
    help: 'Pool size during load test',
    registers: [registry],
  });
  const connectionsInUse = new Gauge({
    name: 'test_prisma_pool_connections_in_use',
    help: 'Connections in use during load test',
    registers: [registry],
  });
  const waitingConnections = new Gauge({
    name: 'test_prisma_pool_waiting_connections',
    help: 'Waiting connections during load test',
    registers: [registry],
  });
  const waitDuration = new Histogram({
    name: 'test_prisma_pool_wait_duration_seconds',
    help: 'Queued connection wait during load test',
    registers: [registry],
  });
  const pool = new Pool({ connectionString, max: 1 });
  monitorPrismaPool(pool, {
    size,
    connectionsInUse,
    waitingConnections,
    waitDuration,
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
  });

  try {
  await prisma.$connect();
  const holder = await pool.connect();

  // async wrapper forces Prisma to actually dispatch each query now
  const queries = Array.from({ length: 10 }, async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  try {
    const deadline = Date.now() + 10_000;
    let waiting = 0;
    while (Date.now() < deadline) {
      waiting = (await waitingConnections.get()).values[0]?.value ?? 0;
      if (waiting === 10) break;
      await delay(50);
    }
    if (waiting !== 10) {
      throw new Error(
        `Expected 10 Prisma queries queued behind the held connection, observed ${waiting}`,
      );
    }
    if (
      (await size.get()).values[0]?.value !== 1 ||
      (await connectionsInUse.get()).values[0]?.value !== 1
    ) {
      throw new Error('Expected the one-connection pool to be fully in use');
    }
  } finally {
    holder.release();
  }

  await Promise.all(queries);
  // ...keep the existing histogram check and logging below

    const waitMetrics = (await waitDuration.get()).values;
    const durationSamples = waitMetrics.find(value =>
      value.metricName?.endsWith('_count'),
    )?.value;
    const waitTimeSeconds = waitMetrics.find(value =>
      value.metricName?.endsWith('_sum'),
    )?.value;
    if (
      !durationSamples ||
      durationSamples < 10 ||
      !waitTimeSeconds ||
      waitTimeSeconds <= 0
    ) {
      throw new Error(
        `Expected 10 positive queued wait observations, received ${durationSamples ?? 0}`,
      );
    }

    console.log(
      `Pool saturation verified: size=1, in_use=1, waiting=10, ` +
        `queued_wait_observations=${durationSamples}, ` +
        `queued_wait_seconds=${waitTimeSeconds.toFixed(3)}`,
    );
  } finally {
    try {
      await prisma.$disconnect();
    } finally {
      await pool.end();
    }
  }
}

void runSaturationTest().catch((error: unknown) => {
  console.error('Prisma pool saturation load test failed:', error);
  process.exitCode = 1;
});
