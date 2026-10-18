import React from 'react';
import { render } from '@testing-library/react-native';
import { DataFreshnessIndicator, formatAge } from '../components/DataFreshnessIndicator';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      surface: '#fff', background: '#000', border: '#ccc', warningBg: '#fee', warningBorder: '#f00',
      warning: '#900', textPrimary: '#111', textSecondary: '#555', info: '#05c', brand: { primary: '#06c' },
    },
  }),
}));

describe('DataFreshnessIndicator', () => {
  it('formats cached data age', () => {
    const now = Date.parse('2026-08-27T12:00:00.000Z');
    expect(formatAge('2026-08-27T11:30:00.000Z', now)).toBe('30 minutes ago');
    expect(formatAge('2026-08-25T12:00:00.000Z', now)).toBe('2 days ago');
  });

  it('distinguishes stale offline-cached data accessibly', () => {
    const { getByA11yLabel } = render(
      <DataFreshnessIndicator
        isCached
        isConnected={false}
        cachedAt={new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()}
        onRefresh={jest.fn()}
      />,
    );
    expect(getByA11yLabel(/offline-cached data/i)).toBeTruthy();
    expect(getByA11yLabel(/stale/i)).toBeTruthy();
  });
});
