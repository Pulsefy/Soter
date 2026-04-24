import React from 'react';
import { render, waitFor, screen } from '@testing-library/react-native';
import { HealthScreen } from '../screens/HealthScreen';
import { fetchHealthStatus } from '../services/api';
import { ThemeProvider } from '../theme/ThemeContext';

// Mock the API module
jest.mock('../services/api');

const mockFetchHealthStatus = fetchHealthStatus as jest.MockedFunction<typeof fetchHealthStatus>;

describe('HealthScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderWithTheme = () =>
    render(
      <ThemeProvider>
        <HealthScreen />
      </ThemeProvider>,
    );

  it('shows loading state initially', () => {
    mockFetchHealthStatus.mockImplementationOnce(() => new Promise(() => {}));
    
    renderWithTheme();
    
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

    renderWithTheme();

    await waitFor(() => {
      expect(screen.getByText('OK')).toBeTruthy();
      expect(screen.getByText('🌐 Live backend data')).toBeTruthy();
      expect(screen.getByLabelText('Service: backend')).toBeTruthy();
      expect(screen.getByLabelText('Version: 1.0.0')).toBeTruthy();
    });
  });

  it('shows mock data label when backend fails', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));

    renderWithTheme();

    await waitFor(() => {
      expect(screen.getByLabelText('Using mock data')).toBeTruthy();
      expect(screen.getByText('📊 Using simulated data')).toBeTruthy();
      expect(screen.getByText('Backend unreachable - showing mock data')).toBeTruthy();
      expect(
        screen.getByLabelText('Warning: This is simulated data. Backend connection failed.'),
      ).toBeTruthy();
    });
  });

  it('shows troubleshooting tips when using mock data', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));

    renderWithTheme();

    await waitFor(() => {
      expect(screen.getByText('🔍 Troubleshooting Tips')).toBeTruthy();
    });
  });

  it('displays the correct mock data structure', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));

    renderWithTheme();

    await waitFor(() => {
      expect(screen.getByText('OK')).toBeTruthy();
      expect(screen.getByLabelText('Service: backend')).toBeTruthy();
      expect(screen.getByLabelText('Version: 0.0.0')).toBeTruthy();
      expect(screen.getByLabelText('Environment: development')).toBeTruthy();
    });
  });

  it('shows retry button when error occurs', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));

    renderWithTheme();

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

    renderWithTheme();

    await waitFor(() => {
      // The env badge element is always rendered
      expect(screen.getByTestId('env-badge')).toBeTruthy();
    });
  });

  it('displays EXPO_PUBLIC_ENV_NAME label when variable is set', async () => {
    process.env.EXPO_PUBLIC_ENV_NAME = 'staging';
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok', service: 'backend', version: '1.0.0',
      environment: 'staging', timestamp: new Date().toISOString(),
    });

    renderWithTheme();

    await waitFor(() => {
      // Environment badge uses accessibilityLabel for stable tests
      expect(screen.getAllByLabelText('Environment: staging').length).toBeGreaterThan(0);
      // Footer includes env label + api url host
      expect(screen.getByLabelText(/Environment: staging ·/)).toBeTruthy();
    });

    delete process.env.EXPO_PUBLIC_ENV_NAME;
  });

  it('falls back to "prod" when EXPO_PUBLIC_API_URL contains "prod"', async () => {
    delete process.env.EXPO_PUBLIC_ENV_NAME;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.prod.example.com';
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok', service: 'backend', version: '1.0.0',
      environment: 'production', timestamp: new Date().toISOString(),
    });

    renderWithTheme();

    await waitFor(() => {
      expect(screen.getByLabelText('Environment: prod')).toBeTruthy();
    });

    delete process.env.EXPO_PUBLIC_API_URL;
  });

  it('defaults to "dev" label when no env variables are set', async () => {
    delete process.env.EXPO_PUBLIC_ENV_NAME;
    delete process.env.EXPO_PUBLIC_API_URL;
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok', service: 'backend', version: '1.0.0',
      environment: 'development', timestamp: new Date().toISOString(),
    });

    renderWithTheme();

    await waitFor(() => {
      expect(screen.getByLabelText('Environment: dev')).toBeTruthy();
    });
  });

  it('renders the footer env row with env label and api url', async () => {
    process.env.EXPO_PUBLIC_ENV_NAME = 'dev';
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:3000';
    mockFetchHealthStatus.mockResolvedValueOnce({
      status: 'ok', service: 'backend', version: '1.0.0',
      environment: 'development', timestamp: new Date().toISOString(),
    });

    renderWithTheme();

    expect(await screen.findByTestId('footer-env-row')).toBeTruthy();
    expect(screen.getByLabelText(/Environment: dev ·/)).toBeTruthy();

    delete process.env.EXPO_PUBLIC_ENV_NAME;
    delete process.env.EXPO_PUBLIC_API_URL;
  });
});
