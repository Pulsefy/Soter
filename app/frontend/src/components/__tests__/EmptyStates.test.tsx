/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

// Campaign route needs a role that can manage campaigns.
process.env.NEXT_PUBLIC_USER_ROLE = 'admin';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '',
}));

// Resolve copy from the real catalog so these assertions also prove the
// empty-state strings live in the i18n message catalog.
jest.mock('next-intl', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const messages = require('@/messages/en.json');
  const resolve = (path: string): string => {
    let node: unknown = messages;
    for (const part of path.split('.')) {
      if (typeof node !== 'object' || node === null) return path;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ? node : path;
  };
  return { useTranslations: () => (key: string) => resolve(key) };
});

const mockApiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// ExportControls renders a Radix Select which needs layout APIs jsdom lacks.
jest.mock('@/components/dashboard/ExportControls', () => ({
  ExportControls: () => <div data-testid="export-controls" />,
}));

jest.mock('@/hooks/useActivity', () => ({
  useActivity: () => ({
    trackJob: (_title: string, _description: string, action: () => Promise<unknown>) =>
      action(),
    trackTransaction: (_title: string, _description: string, action: () => Promise<unknown>) =>
      action(),
  }),
}));

import { FilteredPackageList } from '@/components/dashboard/FilteredPackageList';
import CampaignsPage from '@/app/[locale]/campaigns/page';
import { ToastProvider } from '@/components/ToastProvider';

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

function renderDashboard() {
  return renderWithProviders(
    <FilteredPackageList
      filters={{}}
      page={1}
      size={10}
      onPageChange={jest.fn()}
    />,
  );
}

beforeAll(() => {
  // jsdom does not implement scrollIntoView; the empty-state action calls it.
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  mockApiFetch.mockReset();
});

describe('Dashboard aid-package empty state', () => {
  it('renders the designed empty state for a genuinely empty backend response', async () => {
    mockApiFetch.mockResolvedValue(
      jsonResponse({ data: [], total: 0, page: 1, size: 10, totalPages: 0 }),
    );

    renderDashboard();

    expect(
      (await screen.findAllByTestId('packages-empty-state')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText('No aid packages have been published yet').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole('link', { name: /Create a campaign/ }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('packages-error')).not.toBeInTheDocument();
  });

  it('keeps the loading state distinct from the empty state', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));

    renderDashboard();

    expect(screen.getByTestId('packages-loading')).toBeInTheDocument();
    expect(screen.queryAllByTestId('packages-empty-state')).toHaveLength(0);
  });

  it('keeps the error state distinct from the empty state', async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({}, 500));

    renderDashboard();

    expect(await screen.findByTestId('packages-error')).toBeInTheDocument();
    expect(screen.queryAllByTestId('packages-empty-state')).toHaveLength(0);
  });
});

describe('Campaigns route empty state', () => {
  it('renders a localized empty state with a create-campaign next action', async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({ success: true, data: [] }));

    renderWithProviders(<CampaignsPage />);

    expect(await screen.findByTestId('campaigns-empty-state')).toHaveTextContent(
      'Create your first campaign',
    );

    const nameInput = screen.getByPlaceholderText('e.g. Winter Relief 2026');
    fireEvent.click(screen.getByRole('button', { name: /Create a campaign/ }));
    expect(document.activeElement).toBe(nameInput);
  });

  it('keeps the loading state distinct from the empty state', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<CampaignsPage />);

    expect(screen.getByTestId('campaigns-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('campaigns-empty-state')).not.toBeInTheDocument();
  });

  it('keeps the error state distinct from the empty state', async () => {
    mockApiFetch.mockResolvedValue(jsonResponse({}, 500));

    renderWithProviders(<CampaignsPage />);

    expect(await screen.findByTestId('campaigns-error')).toBeInTheDocument();
    expect(screen.queryByTestId('campaigns-empty-state')).not.toBeInTheDocument();
  });
});
