import React from 'react';
import { render, waitFor, screen, fireEvent } from '@testing-library/react-native';
import { Clipboard } from 'react-native';
import { HealthScreen } from '../screens/HealthScreen';
import { fetchHealthStatus } from '../services/api';
import { config } from '../config';
import {
  cacheHealthStatus,
  loadCachedHealthStatus,
  getHealthCacheTimestamp,
} from '../services/healthCache';

// Mock expo-constants
jest.mock('expo-constants', () => ({
  expoConfig: {
    version: '1.2.3',
  },
}));

// Mock NetInfo
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(() =>
    Promise.resolve({
      isConnected: true,
      isInternetReachable: true,
      type: 'wifi',
      details: { isConnectionExpensive: false },
    }),
  ),
}));

// Mock useTheme
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => {
    const { Colors, SoterLightTheme } = require('../theme/theme');

    return {
      colors: { ...Colors.light, brand: Colors.brand },
      navTheme: SoterLightTheme,
      scheme: 'light',
    };
  },
}));

// Mock the API module
jest.mock('../services/api');

// Mock healthCache
jest.mock('../services/healthCache', () => ({
  cacheHealthStatus: jest.fn().mockResolvedValue(undefined),
  loadCachedHealthStatus: jest.fn().mockResolvedValue(null),
  getHealthCacheTimestamp: jest.fn().mockResolvedValue(null),
  clearHealthCache: jest.fn().mockResolvedValue(undefined),
}));

// Mock the config module
jest.mock('../config', () => ({
  config: {
    apiUrl: 'http://localhost:3000',
    envName: 'dev',
    network: 'testnet',
    walletConnectProjectId: 'test-project-id',
    sorobanContractId: 'CC123...',
    isValid: true,
    errors: [],
  },
}));

const mockFetchHealthStatus = fetchHealthStatus as jest.MockedFunction<typeof fetchHealthStatus>;
const mockCacheHealthStatus = cacheHealthStatus as jest.MockedFunction<typeof cacheHealthStatus>;
const mockLoadCachedHealthStatus = loadCachedHealthStatus as jest.MockedFunction<typeof loadCachedHealthStatus>;
const mockGetHealthCacheTimestamp = getHealthCacheTimestamp as jest.MockedFunction<typeof getHealthCacheTimestamp>;

describe('HealthScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadCachedHealthStatus.mockResolvedValue(null);
    mockGetHealthCacheTimestamp.mockResolvedValue(null);
  });

  it('shows loading state initially', () => {
    mockFetchHealthStatus.mockImplementationOnce(() => new Promise(() => {}));

    render(<HealthScreen />);

    expect(screen.getByText('Checking system health...')).toBeTruthy();
  });

  it('renders live backend data correctly and caches it', async () => {
    const liveData = {
      status: 'ok',
      service: 'backend',
      version: '1.0.0',
      environment: 'development',
      timestamp: new Date().toISOString(),
    };

    mockFetchHealthStatus.mockResolvedValueOnce(liveData);

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('OK')).toBeTruthy();
      expect(screen.getByText('🌐 Live backend data')).toBeTruthy();
      expect(screen.getByText('backend', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('1.0.0', { includeHiddenElements: true })).toBeTruthy();
      expect(mockCacheHealthStatus).toHaveBeenCalledWith(liveData);
    });
  });

  it('shows explicit unavailable state when backend fails and no cache exists', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));
    mockLoadCachedHealthStatus.mockResolvedValueOnce(null);

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('UNAVAILABLE')).toBeTruthy();
      expect(
        screen.getByText(
          'Unable to connect to the backend server and no cached health data is available.',
        ),
      ).toBeTruthy();
      expect(screen.getByText('⚠️ Backend unavailable')).toBeTruthy();
      expect(screen.queryByText('🔧 MOCK')).toBeNull();
      expect(screen.queryByText('📊 Using simulated data')).toBeNull();
      expect(screen.getByText('🔄 Retry Connection')).toBeTruthy();
    });
  });

  it('shows cached real data with age label when backend fails but cached data exists', async () => {
    const cachedData = {
      status: 'ok',
      service: 'backend-production',
      version: '2.1.0',
      environment: 'production',
      timestamp: '2026-08-28T10:00:00Z',
    };

    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));
    mockLoadCachedHealthStatus.mockResolvedValueOnce(cachedData);
    mockGetHealthCacheTimestamp.mockResolvedValueOnce('2026-08-28T10:00:00Z');

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('📦 CACHED', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('backend-production', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('2.1.0', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('📦 Using cached data')).toBeTruthy();
      expect(screen.getByText('Backend unreachable - showing cached health data')).toBeTruthy();
      expect(screen.queryByText('🔧 MOCK')).toBeNull();
    });
  });

  it('shows troubleshooting tips when backend is unreachable', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));
    mockLoadCachedHealthStatus.mockResolvedValueOnce(null);

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('🔍 Troubleshooting Tips')).toBeTruthy();
    });
  });

  it('retries fetching health status when retry button is pressed', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));
    mockLoadCachedHealthStatus.mockResolvedValueOnce(null);

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('🔄 Retry Connection')).toBeTruthy();
    });

    const liveData = {
      status: 'ok',
      service: 'backend',
      version: '1.0.0',
      environment: 'development',
      timestamp: new Date().toISOString(),
    };
    mockFetchHealthStatus.mockResolvedValueOnce(liveData);

    const retryButton = screen.getByText('🔄 Retry Connection');
    fireEvent.press(retryButton);

    await waitFor(() => {
      expect(screen.getByText('🌐 Live backend data')).toBeTruthy();
    });
  });

  // ── Environment indicator tests ─────────────────────────────────────────

  it('shows environment badge in the header', async () => {
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok',
      service: 'backend',
      version: '1.0.0',
      environment: 'development',
      timestamp: new Date().toISOString(),
    });

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('env-badge')).toBeTruthy();
    });
  });

  it('displays environment label from config', async () => {
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok',
      service: 'backend',
      version: '1.0.0',
      environment: 'development',
      timestamp: new Date().toISOString(),
    });

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('env-badge')).toBeTruthy();
      expect(screen.getByTestId('footer-env-name')).toBeTruthy();
    });
  });

  it('shows blockchain diagnostics section', async () => {
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok',
      service: 'backend',
      version: '1.0.0',
      environment: 'development',
      timestamp: new Date().toISOString(),
    });

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('Environment & Blockchain')).toBeTruthy();
      expect(screen.getByText('TESTNET')).toBeTruthy();
      expect(screen.getByText('CC123...')).toBeTruthy();
    });
  });

  it('shows configuration errors when config is invalid', async () => {
    const originalConfig = { ...config };
    (config as any).isValid = false;
    (config as any).errors = ['Missing API Key'];

    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok',
      service: 'backend',
      version: '1.0.0',
      environment: 'development',
      timestamp: new Date().toISOString(),
    });

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('⚠️ Configuration Issues')).toBeTruthy();
      expect(screen.getByText('• Missing API Key')).toBeTruthy();
    });

    Object.assign(config, originalConfig);
  });

  // ── Diagnostics specific tests ─────────────────────────────────────────

  it('renders safe diagnostics elements (app version, api reachability, network state)', async () => {
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok',
      service: 'backend',
      version: '1.0.0',
      environment: 'development',
      timestamp: new Date().toISOString(),
    });

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('Diagnostics')).toBeTruthy();
      expect(screen.getByText('App Version:')).toBeTruthy();
      expect(screen.getByText('1.2.3')).toBeTruthy();
      expect(screen.getByText('API Reachability:')).toBeTruthy();
      expect(screen.getByText('REACHABLE ✅')).toBeTruthy();
      expect(screen.getByText('Network Status:')).toBeTruthy();
      expect(screen.getByText('CONNECTED')).toBeTruthy();
      expect(screen.getByText('Network Type:')).toBeTruthy();
      expect(screen.getByText('WIFI')).toBeTruthy();
      expect(screen.getByText('Internet Reachable:')).toBeTruthy();
      expect(screen.getByText('YES')).toBeTruthy();
    });
  });

  it('copies safe diagnostics to clipboard when button is pressed', async () => {
    const clipboardSpy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});

    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok',
      service: 'backend',
      version: '1.0.0',
      environment: 'development',
      timestamp: new Date().toISOString(),
    });

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('📋 Copy Diagnostics')).toBeTruthy();
    });

    const copyButton = screen.getByText('📋 Copy Diagnostics');
    fireEvent.press(copyButton);

    expect(clipboardSpy).toHaveBeenCalled();
    const copiedText = clipboardSpy.mock.calls[0][0];
    expect(copiedText).toContain('Soter App Diagnostics');
    expect(copiedText).toContain('App Version: 1.2.3');
    expect(copiedText).toContain('API Reachability: Reachable');
    expect(copiedText).toContain('Network Connected: Yes');
    expect(copiedText).toContain('Network Type: WIFI');
    expect(copiedText).toContain('Internet Reachable: Yes');
    expect(copiedText).toContain('Contract ID: CC123...');

    expect(copiedText).not.toContain('test-project-id');

    await waitFor(() => {
      expect(screen.getByText('✅ Diagnostics Copied!')).toBeTruthy();
    });
  });
});
