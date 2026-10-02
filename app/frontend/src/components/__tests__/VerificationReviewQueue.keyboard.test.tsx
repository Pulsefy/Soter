/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ToastProvider';

// Resolve translation keys directly — this component only uses the English
// copy shipped in the catalog, so no provider is required for the assertions.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockInboxItems = [
  {
    id: 'v-1',
    status: 'pending_review',
    createdAt: '2026-08-01T10:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: null,
    deepLink: '/verification/v-1',
    aiScore: 0.4,
    riskLevel: 'medium',
    documentType: 'PASSPORT',
  },
  {
    id: 'v-2',
    status: 'pending_review',
    createdAt: '2026-08-02T10:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: null,
    deepLink: '/verification/v-2',
    aiScore: 0.6,
    riskLevel: 'low',
    documentType: 'NATIONAL_ID',
  },
  {
    id: 'v-3',
    status: 'needs_resubmission',
    createdAt: '2026-08-03T10:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: 'Blurry document',
    nextStepMessage: 'Please resubmit a clearer image.',
    deepLink: '/verification/v-3',
    aiScore: 0.2,
    riskLevel: 'high',
    documentType: 'UTILITY_BILL',
  },
];

// `ReviewQueue` -> `useVerificationInbox` -> `lib/verification-inbox-api` talks
// to the live client in `lib/api-client`, which falls back to the global
// `fetch`; stubbing the demo client here left the queue requesting the network
// in jsdom, where `fetch` is undefined and every case rendered the load error.
jest.mock('@/lib/api-client', () => {
  const actual = jest.requireActual('@/lib/api-client');
  const ok = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
  });

  return {
    ...actual,
    resolveApiUrl: () => 'http://localhost:4000',
    fetchClient: jest.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (
        method === 'POST' &&
        (url.includes('/approve') ||
          url.includes('/reject') ||
          url.includes('/request-resubmission'))
      ) {
        const id = url.split('/v1/verification-inbox/')[1].split('/')[0];
        const item = mockInboxItems.find(i => i.id === id) ?? mockInboxItems[0];
        return ok({ ...item, status: 'approved' });
      }
      if (url.includes('/notes')) return ok([]);
      if (url.includes('/stats')) {
        return ok({
          pending_review: 0,
          approved: 0,
          rejected: 0,
          needs_resubmission: 0,
          total: 0,
        });
      }
      if (/\/v1\/verification-inbox\/[^/?]+$/.test(url)) {
        const id = url.split('/').pop();
        const item = mockInboxItems.find(i => i.id === id) ?? mockInboxItems[0];
        return ok(item);
      }
      return ok({
        items: mockInboxItems,
        total: mockInboxItems.length,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    }),
  };
});

import { ReviewQueue } from '@/components/verification-review/ReviewQueue';

const defaultFilters = {
  status: '' as const,
  riskLevel: '' as const,
  campaignId: '',
  dateFrom: '',
  dateTo: '',
  page: 1,
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderQueue() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <ToastProvider>
        <ReviewQueue filters={defaultFilters} onPageChange={jest.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function itemButton(id: string) {
  return screen.getByRole('button', { name: new RegExp(`^Verification ${id}\\b`) });
}

async function findItemButton(id: string) {
  return screen.findByRole('button', {
    name: new RegExp(`^Verification ${id}\\b`),
  });
}

describe('verification review queue keyboard navigation', () => {
  beforeAll(() => {
    if (!window.requestAnimationFrame) {
      window.requestAnimationFrame = (cb: FrameRequestCallback) =>
        window.setTimeout(() => cb(Date.now()), 0);
    }
  });

  it('renders a visible shortcuts hint', async () => {
    renderQueue();
    await findItemButton('v-1');

    const hint = screen.getByTestId('review-shortcuts-hint');
    expect(hint).toHaveTextContent(/Navigate/);
    expect(hint).toHaveTextContent(/Approve/);
    expect(hint).toHaveTextContent(/Reject/);
    expect(hint).toHaveTextContent(/Details/);
  });

  it('moves focus to the next item with ArrowDown and announces position', async () => {
    renderQueue();
    const first = await findItemButton('v-1');
    const second = itemButton('v-2');

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });

    await waitFor(() => expect(document.activeElement).toBe(second));
    await waitFor(() =>
      expect(screen.getByTestId('review-queue-announcer')).toHaveTextContent(
        'Item 2 of 3, verification v-2.',
      ),
    );
  });

  it('moves focus back with the k shortcut', async () => {
    renderQueue();
    const first = await findItemButton('v-1');
    const second = itemButton('v-2');

    second.focus();
    fireEvent.keyDown(second, { key: 'k' });

    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('expands item details with the e shortcut', async () => {
    renderQueue();
    const first = await findItemButton('v-1');

    first.focus();
    fireEvent.keyDown(first, { key: 'e' });

    await screen.findByText('Evidence Summary');
    expect(first).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens the approve dialog with the a shortcut', async () => {
    renderQueue();
    const first = await findItemButton('v-1');

    first.focus();
    fireEvent.keyDown(first, { key: 'a' });

    expect(await screen.findByText('Approve Verification')).toBeInTheDocument();
  });

  it('opens the reject dialog with the r shortcut', async () => {
    renderQueue();
    const first = await findItemButton('v-1');

    first.focus();
    fireEvent.keyDown(first, { key: 'r' });

    expect(await screen.findByText('Reject Verification')).toBeInTheDocument();
  });

  it('opens the discoverable help overlay with the ? shortcut', async () => {
    renderQueue();
    const first = await findItemButton('v-1');

    first.focus();
    fireEvent.keyDown(first, { key: '?' });

    const help = await screen.findByTestId('review-shortcuts-help');
    expect(help).toHaveTextContent('Keyboard shortcuts');
    expect(help).toHaveTextContent('Approve focused item');
  });

  it('announces the decision and moves focus to the next item after approving', async () => {
    renderQueue();
    const first = await findItemButton('v-1');
    const second = itemButton('v-2');

    first.focus();
    fireEvent.keyDown(first, { key: 'a' });
    await screen.findByText('Approve Verification');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(screen.getByTestId('review-queue-announcer')).toHaveTextContent(
        'Approved verification v-1. Focus moved to the next item.',
      ),
    );
    await waitFor(() => expect(document.activeElement).toBe(second));
  });
});

