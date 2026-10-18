import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  cacheAidList,
  loadCachedAidList,
  getCacheTimestamp,
  clearAidCache,
  cacheAidDetails,
  loadCachedAidDetails,
  getAidDetailsCacheTimestamp,
  clearAidDetailsCache,
} from '../services/aidCache';
import { AidPackage } from '../services/api';
import { AidDetails } from '../services/aidApi';

describe('aidCache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  const sampleAidPackages: AidPackage[] = [
    { id: 'aid-1', title: 'Food Aid', amount: 500, status: 'active', date: '2026-01-01' },
  ];

  const sampleAidDetails: AidDetails = {
    id: 'aid-1',
    title: 'Food Aid',
    description: 'Emergency food packages',
    recipient: {
      name: 'Amina Yusuf',
      id: 'REC-2041',
      wallet: 'GAKD...Q9X2',
    },
    tokenType: 'USDC',
    amount: '500',
    expiryDate: '2026-01-10T00:00:00Z',
    status: 'verified',
    claimId: 'claim-aid-1',
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('persists and loads aid list and timestamp', async () => {
    expect(await loadCachedAidList()).toBeNull();
    await cacheAidList(sampleAidPackages);
    expect(await loadCachedAidList()).toEqual(sampleAidPackages);
    expect(await getCacheTimestamp()).toBeTruthy();
    await clearAidCache();
    expect(await loadCachedAidList()).toBeNull();
  });

  it('persists and loads aid details and timestamp', async () => {
    expect(await loadCachedAidDetails('aid-1')).toBeNull();
    await cacheAidDetails('aid-1', sampleAidDetails);
    expect(await loadCachedAidDetails('aid-1')).toEqual(sampleAidDetails);
    const ts = await getAidDetailsCacheTimestamp('aid-1');
    expect(ts).toBeTruthy();
    expect(Number.isNaN(new Date(ts!).getTime())).toBe(false);
    await clearAidDetailsCache('aid-1');
    expect(await loadCachedAidDetails('aid-1')).toBeNull();
  });
});
