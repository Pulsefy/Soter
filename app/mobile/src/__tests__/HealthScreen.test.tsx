import React from 'react';
import { render, waitFor, screen, fireEvent } from '@testing-library/react-native';
import { Clipboard } from 'react-native';
import { HealthScreen } from '../screens/HealthScreen';
import { fetchHealthStatus } from '../services/api';
import { config } from '../config';

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
const mockConfig = config as jest.Mocked<typeof config>;

describe('HealthScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockFetchHealthStatus.mockImplementationOnce(() => new Promise(() => {}));
    
    render(<HealthScreen />);
    
    expect(screen.getByText('Checking system health...')).toBeTruthy();
  });

  it('renders live backend data correctly', async () => {
    const mockData = {
      status: 'ok',
      service: 'backend',
      version: '1.0.0',
      environment: 'development',
      timestamp: new Date().toISOString(),
    };

    mockFetchHealthStatus.mockResolvedValueOnce(mockData);

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('OK')).toBeTruthy();
      expect(screen.getByText('🌐 Live backend data')).toBeTruthy();
      expect(screen.getByText('backend', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('1.0.0', { includeHiddenElements: true })).toBeTruthy();
    });
  });

  it('shows mock data label when backend fails', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('🔧 MOCK', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('📊 Using simulated data')).toBeTruthy();
      expect(screen.getByText('Backend unreachable - showing mock data')).toBeTruthy();
      expect(screen.getByText('⚠️ This is simulated data - backend connection failed', { includeHiddenElements: true })).toBeTruthy();
    });
  });

  it('shows troubleshooting tips when using mock data', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('🔍 Troubleshooting Tips')).toBeTruthy();
    });
  });

  it('displays the correct mock data structure', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('backend', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('0.0.0', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('development', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('✅', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText('OK')).toBeTruthy();
    });
  });

  it('shows retry button when error occurs', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('🔄 Retry Connection')).toBeTruthy();
    });
  });

  // ── Environment indicator tests ─────────────────────────────────────────

  it('shows environment badge in the header', async () => {
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok', service: 'backend', version: '1.0.0',
      environment: 'development', timestamp: new Date().toISOString(),
    });

    render(<HealthScreen />);

    await waitFor(() => {
      // The env badge element is always rendered
      expect(screen.getByTestId('env-badge')).toBeTruthy();
    });
  });

  it('displays environment label from config', async () => {
    // Note: Since config is mocked as a constant above, we'd need to change the mock 
    // implementation if we wanted to test different values in the same file, 
    // or just verify it shows what's in our default mock.
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok', service: 'backend', version: '1.0.0',
      environment: 'development', timestamp: new Date().toISOString(),
    });

    render(<HealthScreen />);

    await waitFor(() => {
      // Default mocked envName is 'dev'
      expect(screen.getByTestId('env-badge')).toBeTruthy();
      expect(screen.getByTestId('footer-env-name')).toBeTruthy();
    });
  });

  it('shows blockchain diagnostics section', async () => {
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok', service: 'backend', version: '1.0.0',
      environment: 'development', timestamp: new Date().toISOString(),
    });

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('Environment & Blockchain')).toBeTruthy();
      expect(screen.getByText('TESTNET')).toBeTruthy();
      expect(screen.getByText('CC123...')).toBeTruthy();
    });
  });

  it('shows configuration errors when config is invalid', async () => {
    // Temporarily modify the mock for this test
    const originalConfig = { ...config };
    (config as any).isValid = false;
    (config as any).errors = ['Missing API Key'];

    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok', service: 'backend', version: '1.0.0',
      environment: 'development', timestamp: new Date().toISOString(),
    });

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('⚠️ Configuration Issues')).toBeTruthy();
      expect(screen.getByText('• Missing API Key')).toBeTruthy();
    });

    // Restore
    Object.assign(config, originalConfig);
  });

  // ── Diagnostics specific tests ─────────────────────────────────────────

  it('renders safe diagnostics elements (app version, api reachability, network state)', async () => {
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok', service: 'backend', version: '1.0.0',
      environment: 'development', timestamp: new Date().toISOString(),
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
      status: 'ok', service: 'backend', version: '1.0.0',
      environment: 'development', timestamp: new Date().toISOString(),
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
    
    // Ensure no secrets are present
    expect(copiedText).not.toContain('test-project-id');

    await waitFor(() => {
      expect(screen.getByText('✅ Diagnostics Copied!')).toBeTruthy();
    });
  });
});
