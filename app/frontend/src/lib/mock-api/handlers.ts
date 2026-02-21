import { BackendHealthResponse } from '@/types/health';

export type MockHandler = (
  url: string,
  options?: RequestInit,
) => Promise<Response>;

const healthHandler: MockHandler = async () => {
  const mockResponse: BackendHealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0-mock',
    service: 'soter-backend-mock',
    details: {
      uptime: 12345,
    },
  };

  return new Response(JSON.stringify(mockResponse), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const aidPackagesHandler: MockHandler = async () => {
  const mockPackages = [
    { id: '1', name: 'Food Aid', status: 'pending' },
    { id: '2', name: 'Medical Supplies', status: 'delivered' },
  ];

  return new Response(JSON.stringify(mockPackages), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const handlers: Record<string, MockHandler> = {
  '/health': healthHandler,
  '/aid-packages': aidPackagesHandler,
};
