/** @jest-environment jsdom */

import { act, render, screen, waitFor } from '@testing-library/react';
import { DashboardSummaryCards } from './DashboardSummaryCards';
import { fetchGlobalStats } from '@/lib/analytics-api';

jest.mock('@/lib/analytics-api', () => ({
  fetchGlobalStats: jest.fn(),
}));

const mockFetchGlobalStats = jest.mocked(fetchGlobalStats);

describe('DashboardSummaryCards', () => {
  beforeEach(() => {
    mockFetchGlobalStats.mockReset();
  });

  it('shows loading while requesting real dashboard statistics', () => {
    mockFetchGlobalStats.mockReturnValue(new Promise(() => {}));
    render(<DashboardSummaryCards />);

    expect(
      screen.getByRole('status', { name: 'Loading dashboard summary' }),
    ).toBeTruthy();
  });

  it('renders the metrics from the backend global-stats contract', async () => {
    mockFetchGlobalStats.mockResolvedValue({
      totalAidDisbursed: 1500,
      totalRecipients: 12,
      activeCampaigns: 3,
      byToken: [],
      byRegion: [],
      timeSeries: [],
      computedAt: '2026-09-28T00:00:00.000Z',
    });
    render(<DashboardSummaryCards />);

    expect(await screen.findByText('1,500')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(mockFetchGlobalStats).toHaveBeenCalledTimes(1);
  });

  it('shows the API configuration error and can retry', async () => {
    mockFetchGlobalStats
      .mockRejectedValueOnce(
        new Error('Dashboard summary requires NEXT_PUBLIC_API_URL.'),
      )
      .mockResolvedValueOnce({
        totalAidDisbursed: 0,
        totalRecipients: 0,
        activeCampaigns: 0,
        byToken: [],
        byRegion: [],
        timeSeries: [],
        computedAt: '2026-09-28T00:00:00.000Z',
      });
    render(<DashboardSummaryCards />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('NEXT_PUBLIC_API_URL');
    await act(async () => {
      screen.getByRole('button', { name: 'Retry' }).click();
    });
    await waitFor(() => expect(mockFetchGlobalStats).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Active Campaigns')).toBeTruthy();
  });
});
