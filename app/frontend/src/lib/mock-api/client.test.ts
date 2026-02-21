import { fetchClient } from './client';
import { handlers } from './handlers';

// Mock environment variables
process.env.NEXT_PUBLIC_USE_MOCKS = 'true';
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';

// Mock global fetch
global.fetch = jest.fn();

describe('Mock API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should route to mock handler when mocks are enabled', async () => {
    const fetchPromise = fetchClient('http://localhost:4000/health');
    
    // Fast-forward time to skip the 500ms delay
    jest.advanceTimersByTime(500);
    
    const response = await fetchPromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.version).toBe('1.0.0-mock');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should return mock aid packages', async () => {
    const fetchPromise = fetchClient('http://localhost:4000/aid-packages');
    
    jest.advanceTimersByTime(500);
    
    const response = await fetchPromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should handle query parameters correctly', async () => {
    const fetchPromise = fetchClient('http://localhost:4000/aid-packages?status=pending&sort=desc');
    
    jest.advanceTimersByTime(500);
    
    const response = await fetchPromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should handle relative URLs', async () => {
    const fetchPromise = fetchClient('/health');
    
    jest.advanceTimersByTime(500);
    
    const response = await fetchPromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should use real fetch when no mock handler exists', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response('real response'),
    );

    await fetchClient('http://localhost:4000/unknown-endpoint');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/unknown-endpoint',
      undefined,
    );
  });

  it('should use real fetch when mocks are disabled', async () => {
    process.env.NEXT_PUBLIC_USE_MOCKS = 'false';
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response('real response'),
    );

    await fetchClient('http://localhost:4000/health');

    expect(global.fetch).toHaveBeenCalled();

    // Reset env var
    process.env.NEXT_PUBLIC_USE_MOCKS = 'true';
  });
});
