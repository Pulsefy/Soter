import { HealthStatus } from './api';

/**
 * Mock health data generator.
 * Accessible only from tests and development builds.
 */
export const getMockHealthData = (): HealthStatus => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('mockData.ts cannot be used in production builds');
  }

  return {
    status: 'ok',
    service: 'backend',
    version: '0.0.0',
    environment: 'development',
    timestamp: new Date().toISOString(),
    mocked: true,
  };
};