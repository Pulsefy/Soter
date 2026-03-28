/**
 * Unit tests for src/services/api.ts
 */
import { fetchHealthStatus, getAidPackages } from '../services/api';

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

beforeEach(() => { mockFetch.mockReset(); });

describe('fetchHealthStatus', () => {
  it('returns parsed health data on 200', async () => {
    const payload = { status: 'ok', service: 'soter-backend', version: '1.0.0', environment: 'test', timestamp: '2026-01-01T00:00:00Z' };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload });
    const result = await fetchHealthStatus();
    expect(result).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/health'));
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(fetchHealthStatus()).rejects.toThrow('HTTP error! status: 503');
  });

  it('throws on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(fetchHealthStatus()).rejects.toThrow('Network request failed');
  });
});

describe('getAidPackages', () => {
  const mockPackages = [
    { id: 'aid-1', title: 'Food Aid', amount: 500, status: 'active', date: '2026-01-01' },
    { id: 'aid-2', title: 'Medical Aid', amount: 1200, status: 'pending', date: '2026-01-02' },
  ];

  it('returns array of aid packages on 200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockPackages });
    const result = await getAidPackages();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('aid-1');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(getAidPackages()).rejects.toThrow('HTTP error! status: 404');
  });

  it('throws on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'));
    await expect(getAidPackages()).rejects.toThrow('timeout');
  });

  it('calls the /aid endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    await getAidPackages();
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/aid$/);
  });

  it('returns empty array when server returns []', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    expect(await getAidPackages()).toEqual([]);
  });
});