import { HealthStatus } from './api';

export const getMockHealthData = (): HealthStatus => {
  return {
    status: 'ok',
    service: 'backend',
    version: '0.0.0',
    environment: 'development',
    timestamp: new Date().toISOString(),
    mocked: true,
  };
};