import { config } from '../config';
import { guardAgainstPinningFailure } from './certificatePinning';
import { buildCorrelationHeaders, structuredLogger } from './logger';

const API_URL = config.apiUrl;

export interface HealthStatus {
  status: string;
  service: string;
  version: string;
  environment: string;
  timestamp: string;
  mocked?: boolean;
}

export const fetchHealthStatus = async (): Promise<HealthStatus> => {
  const url = `${API_URL}/health`;
  const correlationId = structuredLogger.getCurrentCorrelationId();

  try {
    structuredLogger.info(
      'backend.health.request.start',
      { url, correlationId },
      'api',
    );

    const response = await fetch(url, {
      method: 'GET',
      headers: buildCorrelationHeaders(correlationId),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    structuredLogger.info(
      'backend.health.request.success',
      { url, status: response.status, service: data.service, version: data.version },
      'api',
    );
    return data;
  } catch (error) {
    structuredLogger.error(
      'backend.health.request.failed',
      { url, error: error instanceof Error ? error.message : String(error), correlationId },
      'api',
    );
    return guardAgainstPinningFailure(url, error);
  }
};

export interface AidPackage {
  id: string;
  title: string;
  amount: number;
  status: string;
  date: string;
}

export const getAidPackages = async (): Promise<AidPackage[]> => {
  const url = `${API_URL}/aid`;
  const correlationId = structuredLogger.getCurrentCorrelationId();

  try {
    structuredLogger.info('backend.aid.request.start', { url, correlationId }, 'api');
    const response = await fetch(url, {
      method: 'GET',
      headers: buildCorrelationHeaders(correlationId),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    structuredLogger.info(
      'backend.aid.request.success',
      { url, count: Array.isArray(data) ? data.length : 0 },
      'api',
    );
    return data;
  } catch (error) {
    structuredLogger.error(
      'backend.aid.request.failed',
      { url, error: error instanceof Error ? error.message : String(error), correlationId },
      'api',
    );
    return guardAgainstPinningFailure(url, error);
  }
};