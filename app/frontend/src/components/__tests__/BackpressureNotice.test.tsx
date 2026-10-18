/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackpressureNotice } from '../BackpressureNotice';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) =>
    key === 'backpressure.notice'
      ? 'Processing may be slower than usual right now.'
      : key,
}));

function renderNotice() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BackpressureNotice />
    </QueryClientProvider>,
  );
}

function mockSignal(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe('BackpressureNotice', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows a non-blocking notice when the queue reports backpressure', async () => {
    mockSignal({ active: true, level: 'elevated' });
    renderNotice();

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Processing may be slower than usual');
    expect(notice).toHaveAttribute('data-level', 'elevated');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders nothing when load is normal', async () => {
    mockSignal({ active: false, level: 'normal' });
    renderNotice();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('backpressure-notice')).not.toBeInTheDocument();
  });

  it('stays hidden when the signal endpoint fails', async () => {
    mockSignal({}, false);
    renderNotice();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('backpressure-notice')).not.toBeInTheDocument();
  });
});
