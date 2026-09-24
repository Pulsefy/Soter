/** @jest-environment jsdom */

import { clusterPoints, MAP_TARGET_MARKERS } from '../map-clustering';

function createLargeFixture(size: number) {
  return Array.from({ length: size }, (_, index) => ({
    id: `fixture-${index}`,
    lat: -60 + ((index * 37) % 12000) / 100,
    lng: -180 + ((index * 71) % 36000) / 100,
    amount: 10,
    token: 'USDC',
    status: 'delivered',
  }));
}

describe('AidDistributionMap performance budget', () => {
  it('keeps a 10,000-point fixture within the documented marker budget', () => {
    const fixture = createLargeFixture(10_000);
    const startedAt = performance.now();
    const clusters = clusterPoints(fixture, 8, {
      north: 85,
      south: -85,
      east: 180,
      west: -180,
    });
    const elapsedMs = performance.now() - startedAt;

    console.info(`Aid map benchmark: ${fixture.length} points -> ${clusters.length} markers in ${elapsedMs.toFixed(1)}ms`);
    expect(clusters.length).toBeLessThanOrEqual(MAP_TARGET_MARKERS);
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('does not cluster points outside the viewport', () => {
    const fixture = createLargeFixture(1000);
    const clusters = clusterPoints(fixture, 4, {
      north: 10,
      south: -10,
      east: 20,
      west: -20,
    });

    expect(clusters.every(cluster => cluster.lat >= -10 && cluster.lat <= 10)).toBe(true);
  });
});