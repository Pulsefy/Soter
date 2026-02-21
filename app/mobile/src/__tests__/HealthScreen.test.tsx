import React from 'react';
import { render, waitFor, screen } from '@testing-library/react-native';
import { HealthScreen } from '../screens/HealthScreen';
import { fetchHealthStatus } from '../services/api';

// Mock the API module
jest.mock('../services/api');

const mockFetchHealthStatus = fetchHealthStatus as jest.MockedFunction<typeof fetchHealthStatus>;

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
      expect(screen.getByText('backend')).toBeTruthy();
      expect(screen.getByText('1.0.0')).toBeTruthy();
    });
  });

  it('shows mock data label when backend fails', async () => {
    mockFetchHealthStatus.mockRejectedValueOnce(new Error('Network error'));

    render(<HealthScreen />);

    await waitFor(() => {
      expect(screen.getByText('🔧 MOCK DATA')).toBeTruthy();
      expect(screen.getByText('📊 Using simulated data')).toBeTruthy();
      expect(screen.getByText('Backend unreachable - showing mock data')).toBeTruthy();
      expect(screen.getByText('⚠️ This is simulated data - backend connection failed')).toBeTruthy();
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
      expect(screen.getByText('backend')).toBeTruthy();
      expect(screen.getByText('0.0.0')).toBeTruthy();
      expect(screen.getByText('development')).toBeTruthy();
      expect(screen.getByText('✅')).toBeTruthy();
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
});

