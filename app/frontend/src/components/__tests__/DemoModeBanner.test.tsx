/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { DemoModeBanner } from '../DemoModeBanner';

describe('DemoModeBanner', () => {
  it('is non-dismissible in demo mode (fixture)', () => {
    render(<DemoModeBanner mode="fixture" />);

    expect(
      screen.getByText('Demo mode — fixture data active'),
    ).toBeInTheDocument();
    // No dismiss control of any kind can hide the notice.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is non-dismissible in degraded mode (deterministic)', () => {
    render(<DemoModeBanner mode="deterministic" />);

    expect(
      screen.getByText('Degraded mode — deterministic output active'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('always shows the indicator, reporting live backend data when live', () => {
    render(<DemoModeBanner mode="live" />);

    expect(screen.getByText('Live backend data')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('exposes the indicator as a status region', () => {
    render(<DemoModeBanner mode="live" />);

    expect(screen.getByRole('status')).toHaveTextContent('Live backend data');
  });
});
