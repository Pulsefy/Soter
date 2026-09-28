import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  cacheHealthStatus,
  loadCachedHealthStatus,
  getHealthCacheTimestamp,
  clearHealthCache,
} from '../services/healthCache';
import { HealthStatus } from '../services/api';

describe('healthCache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  const sampleHealth: HealthStatus = {
    status: 'ok',
    service: 'backend-test',
    version: '1.2.0',
    environment: 'staging',
    timestamp: '2026-08-28T12:00:00Z',
  };

  it('persists and loads health status', async () => {
    expect(await loadCachedHealthStatus()).toBeNull();
    await cacheHealthStatus(sampleHealth);
    const loaded = await loadCachedHealthStatus();
    expect(loaded).toEqual(sampleHealth);
  });

  it('retrieves valid timestamp after cache write', async () => {
    expect(await getHealthCacheTimestamp()).toBeNull();
    await cacheHealthStatus(sampleHealth);
    const ts = await getHealthCacheTimestamp();
    expect(ts).toBeTruthy();
    expect(Number.isNaN(new Date(ts!).getTime())).toBe(false);
  });

  it('clears health cache', async () => {
    await cacheHealthStatus(sampleHealth);
    expect(await loadCachedHealthStatus()).toEqual(sampleHealth);
    await clearHealthCache();
    expect(await loadCachedHealthStatus()).toBeNull();
    expect(await getHealthCacheTimestamp()).toBeNull();
  });
});
