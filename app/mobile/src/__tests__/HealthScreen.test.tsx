import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { HealthScreen } from '../screens/HealthScreen';

// Mock fetch
global.fetch = jest.fn();

describe('HealthScreen', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  it('renders health status from API', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok', version: '1.2.3' }),
    });

    const { getByText } = render(<HealthScreen />);

    await waitFor(() => {
      expect(getByText('Status: ok')).toBeTruthy();
      expect(getByText('Version: 1.2.3')).toBeTruthy();
    });
  });

  it('renders mock data when API fails', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const { getByText } = render(<HealthScreen />);

    await waitFor(() => {
      expect(getByText('Error: Network error')).toBeTruthy();
      expect(getByText('Using mock data for demonstration')).toBeTruthy();
      expect(getByText('Status: ok')).toBeTruthy();
    });
  });
});
