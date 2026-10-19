/**
 * @jest-environment jsdom
 */

import React from 'react';
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { OfflineIndicator } from '../OfflineIndicator';
import {
  markNetworkResponseServed,
  markServingCachedData,
  resetOfflineStatusForTests,
  setConnectivityOnline,
} from '@/lib/offline-status';

jest.mock('next-intl', () => ({
  useTranslations:
    () => (key: string) => {
      const map: Record<string, string> = {
        banner: "You're offline — showing cached data from your last connection.",
        unreachable:
          "Can't reach the server — showing cached data. Reconnecting automatically.",
      };
      return map[key] ?? key;
    },
}));

describe('OfflineIndicator', () => {
  beforeEach(() => {
    act(() => resetOfflineStatusForTests());
  });

  afterEach(() => {
    act(() => resetOfflineStatusForTests());
  });

  it('renders nothing while online with fresh data', () => {
    const { container } = render(<OfflineIndicator />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the offline banner when connectivity drops', () => {
    render(<OfflineIndicator />);

    act(() => {
      setConnectivityOnline(false);
    });

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('offline');
    expect(banner).toHaveTextContent('cached data');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('shows the unreachable banner when online but the backend is down', () => {
    render(<OfflineIndicator />);

    act(() => {
      markServingCachedData({
        url: 'http://localhost:4000/api/v1/analytics/global-stats',
        cachedAt: Date.now(),
        stale: false,
      });
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      "Can't reach the server",
    );
  });

  it('hides the banner once a live response is served again', () => {
    render(<OfflineIndicator />);

    act(() => {
      markServingCachedData({ url: '/api/v1/aid/packages', cachedAt: Date.now(), stale: false });
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      markNetworkResponseServed();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
