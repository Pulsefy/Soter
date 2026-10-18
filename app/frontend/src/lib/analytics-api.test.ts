import { fetchGlobalStats } from './analytics-api';

describe('fetchGlobalStats', () => {
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
  const originalUseMocks = process.env.NEXT_PUBLIC_USE_MOCKS;
  const fetchMock = jest.spyOn(global, 'fetch');

  afterEach(() => {
    jest.resetAllMocks();
  });

  afterAll(() => {
    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    }
    if (originalUseMocks === undefined) {
      delete process.env.NEXT_PUBLIC_USE_MOCKS;
    } else {
      process.env.NEXT_PUBLIC_USE_MOCKS = originalUseMocks;
    }
  });

  it('calls the real global-stats endpoint and parses its raw DTO', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.soter.test';
    const stats = {
      totalAidDisbursed: 1500,
      totalRecipients: 12,
      activeCampaigns: 3,
      byToken: [],
      byRegion: [],
      timeSeries: [],
      computedAt: '2026-09-28T00:00:00.000Z',
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(stats), { status: 200 }),
    );

    await expect(fetchGlobalStats()).resolves.toEqual(stats);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.soter.test/api/v1/analytics/global-stats',
    );
  });

  it('rejects clearly when the API URL is not configured, without fetching', async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_USE_MOCKS;

    await expect(fetchGlobalStats()).rejects.toThrow('NEXT_PUBLIC_API_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces non-success HTTP responses', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.soter.test';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Analytics unavailable' }), {
        status: 503,
      }),
    );

    await expect(fetchGlobalStats()).rejects.toThrow('Analytics unavailable');
  });
});
