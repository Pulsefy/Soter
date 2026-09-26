import { getMockHealthData } from '../services/mockData';

describe('mockData', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('returns mock health data in non-production environments', () => {
    process.env.NODE_ENV = 'development';
    const data = getMockHealthData();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('backend');
    expect(data.version).toBe('0.0.0');
    expect(data.environment).toBe('development');
    expect(data.mocked).toBe(true);
  });

  it('throws an error when accessed in a production environment', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getMockHealthData()).toThrow(
      'mockData.ts cannot be used in production builds',
    );
  });
});
