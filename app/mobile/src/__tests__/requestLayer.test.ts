/**
 * Unit tests for src/services/requestLayer.ts
 */
import { apiRequest, apiGet, apiPost } from '../services/requestLayer';

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
  jest.useRealTimers();
});

describe('apiRequest', () => {
  it('returns parsed data on 200', async () => {
    const payload = { ok: true, data: { id: 1 } };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => payload,
    });

    const result = await apiRequest({ method: 'GET', path: '/test' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(payload);
    expect(result.retries).toBe(0);
  });

  it('retries on 500 and succeeds on second attempt', async () => {
    jest.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: 'ok' }) });

    const promise = apiRequest({ method: 'GET', path: '/test', maxRetries: 2 });

    // Advance past the backoff timer
    jest.advanceTimersByTime(15000);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.retries).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries', async () => {
    jest.useFakeTimers();

    mockFetch.mockRejectedValue(new Error('Network error'));

    const promise = apiRequest({ method: 'GET', path: '/test', maxRetries: 1 });

    jest.advanceTimersByTime(15000);

    await expect(promise).rejects.toThrow('Network error');
    expect(mockFetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('aborts when deadline is exceeded', async () => {
    jest.useFakeTimers();

    // fetch never resolves — deadline should abort
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const promise = apiRequest({ method: 'GET', path: '/test', deadlineMs: 1000 });

    jest.advanceTimersByTime(1500);

    await expect(promise).rejects.toThrow();
  });

  it('generates idempotency key for POST', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ created: true }),
    });

    await apiRequest({ method: 'POST', path: '/submit', body: { x: 1 } });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Idempotency-Key']).toBeDefined();
    expect(headers['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('does not add idempotency key for GET', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await apiRequest({ method: 'GET', path: '/data' });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('uses provided idempotency key when given', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await apiRequest({
      method: 'POST',
      path: '/submit',
      idempotencyKey: 'my-custom-key',
    });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Idempotency-Key']).toBe('my-custom-key');
  });

  it('retries on 429 rate limit', async () => {
    jest.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const promise = apiRequest({ method: 'GET', path: '/test', maxRetries: 2 });
    jest.advanceTimersByTime(15000);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.retries).toBe(1);
  });

  it('does not retry on 400 bad request', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });

    await expect(
      apiRequest({ method: 'GET', path: '/test', maxRetries: 3 }),
    ).rejects.toThrow('HTTP 400');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('convenience wrappers', () => {
  it('apiGet calls apiRequest with GET', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });

    const result = await apiGet('/items');
    expect(result.ok).toBe(true);
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
  });

  it('apiPost calls apiRequest with POST', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 1 }),
    });

    const result = await apiPost('/items', { name: 'test' });
    expect(result.ok).toBe(true);
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});
