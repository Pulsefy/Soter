/**
 * @jest-environment ./jest.jsdom-fetch.environment.js
 */

/**
 * Smoke test for the reviewer-facing verification-review route
 * (`app/frontend/src/app/[locale]/verification-review/`).
 *
 * Unlike `smoke.test.tsx` — which renders the route with every data source
 * mocked and only checks that the shell paints — this suite runs the real page
 * against a real HTTP backend (see `support/verification-inbox-test-backend.ts`)
 * and drives it the way a reviewer does: load the queue, open a case, approve
 * one and reject another.
 *
 * Each `it()` is one step of the flow and is named `[step] …`, so a CI failure
 * says which of load / list / action broke rather than just "smoke test
 * failed". The assertions inside a step also carry the step name in their
 * failure message via `step()`.
 *
 * Deliberately out of scope: wallet/Freighter state, the review-lock handshake
 * and the claims/verification backend wiring (tracked separately).
 */

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  configure,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ToastProvider';
import enCatalogue from '@/messages/en.json';
import {
  startVerificationInboxTestBackend,
  type VerificationInboxTestBackend,
} from './support/verification-inbox-test-backend';

/** next-intl's `t()`: a lookup that also answers `t.has()`. */
type Translator = ((key: string) => string) & { has: (key: string) => boolean };

function catalogueLookup(key: string): string | undefined {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      enCatalogue,
    ) as string | undefined;
}

// `next-intl` v4 ships ESM only, which the CommonJS Jest runtime cannot parse.
// Resolve keys against the committed catalogue so translated copy renders as
// the reviewer sees it instead of as raw message keys.
jest.mock('next-intl', () => {
  const lookup = (key: string): string | undefined => {
    const value = catalogueLookup(key);
    return typeof value === 'string' ? value : undefined;
  };
  return {
    useTranslations: () => {
      const t = ((key: string) => lookup(key) ?? key) as Translator;
      t.has = (key: string) => lookup(key) !== undefined;
      return t;
    },
    useLocale: () => 'en',
  };
});

// The route reads its filters from the URL. `mock` prefix keeps the variable
// reachable from the hoisted factory below.
const mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/en/verification-review',
  useSearchParams: () => mockSearchParams,
  useParams: () => ({ locale: 'en' }),
}));

const CASE_TO_APPROVE = 'clv-approve-001';
const CASE_TO_REJECT = 'clv-reject-002';

let backend: VerificationInboxTestBackend;
let queryClient: QueryClient;
let VerificationReviewPage: React.ComponentType;

// Every wait in this suite crosses the process boundary (HTTP → test backend →
// re-render), so the 1s default is tight on a loaded CI runner.
configure({ asyncUtilTimeout: 5000 });

/** Names every failure with the step it belongs to. */
function step(name: string, assertion: () => void): void {
  try {
    assertion();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`[${name}] ${detail}`);
  }
}

function renderRoute() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <VerificationReviewPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Opens a queue row and waits for its detail panel to load from the backend. */
async function openCase(id: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Verification ${id}` }));
  await screen.findByText(/Evidence Summary/i);
}

function requestsTo(method: string, path: string) {
  return backend.requests.filter(
    request => request.method === method && request.path === path,
  );
}

beforeAll(async () => {
  backend = await startVerificationInboxTestBackend();

  // Point the app at the test backend before any module captures the URL:
  // `lib/verification-inbox-api.ts` and `lib/mock-api/client.ts` both read
  // `NEXT_PUBLIC_API_URL`, and demo mode must stay off so requests really leave
  // the process.
  process.env.NEXT_PUBLIC_API_URL = backend.url;
  process.env.NEXT_PUBLIC_USE_MOCKS = 'false';

  const pageModule = await import('@/app/[locale]/verification-review/page');
  VerificationReviewPage = pageModule.default;
});

afterAll(async () => {
  await backend.close();
});

beforeEach(() => {
  backend.reset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  queryClient.clear();
});

describe('verification-review route smoke test (against test backend)', () => {
  it('[load] renders the reviewer route', async () => {
    renderRoute();

    const heading = await screen.findByRole('heading', {
      name: /Verification Review/i,
      level: 1,
    });
    step('load', () => {
      expect(heading).toBeInTheDocument();
      expect(screen.getByText(/Manual review queue for flagged verification cases/i)).toBeInTheDocument();
    });
  });

  it('[list] shows the verification cases served by the backend', async () => {
    renderRoute();

    // Loading skeletons must give way to real rows.
    for (const id of [CASE_TO_APPROVE, CASE_TO_REJECT, 'clv-resubmit-003']) {
      const row = await screen.findByRole('button', { name: `Verification ${id}` });
      step('list', () => {
        expect(row).toBeInTheDocument();
      });
    }

    step('list', () => {
      expect(screen.queryByText(/No verification cases match the current filters/i)).not.toBeInTheDocument();
    });
    step('list', () => {
      expect(requestsTo('GET', '/v1/verification-inbox')).not.toHaveLength(0);
    });
    step('list', () => {
      // Counts come from their own endpoint; a failure there replaces the
      // tiles with the "Stats temporarily unavailable" notice.
      expect(requestsTo('GET', '/v1/verification-inbox/stats')).not.toHaveLength(0);
      expect(screen.queryByText(/Stats temporarily unavailable/i)).not.toBeInTheDocument();
    });

    // Every call the route makes — queue, stats, and the campaigns dropdown —
    // must reach a route the backend serves; a 4xx anywhere fails the step.
    await waitFor(() => {
      step('list', () => {
        expect(backend.requests.some(r => r.path === '/v1/campaigns')).toBe(true);
        const failed = backend.requests
          .filter(r => r.status >= 400)
          .map(r => `${r.method} ${r.path} → ${r.status}`);
        expect(failed).toEqual([]);
      });
    });
  });

  it('[action:approve] approves a queued case from the review dialog', async () => {
    renderRoute();
    await openCase(CASE_TO_APPROVE);

    // Detail panel is open: act on the case, which opens the confirm dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    step('action:approve', () => {
      expect(within(dialog).getByText('Approve Verification')).toBeInTheDocument();
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    // The dialog closes once the mutation settles; while it is open Radix marks
    // the queue `aria-hidden`, so wait for it to go before reading the row.
    await waitFor(() => {
      step('action:approve', () => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    // Server truth wins: the row's badge flips once the queue refetches.
    await waitFor(() => {
      step('action:approve', () => {
        const row = screen.getByRole('button', { name: `Verification ${CASE_TO_APPROVE}` });
        expect(within(row).getByText('Approved')).toBeInTheDocument();
      });
    });

    step('action:approve', () => {
      const posted = requestsTo('POST', `/v1/verification-inbox/${CASE_TO_APPROVE}/approve`);
      expect(posted).toHaveLength(1);
      expect(backend.item(CASE_TO_APPROVE)?.status).toBe('approved');
      expect(backend.item(CASE_TO_APPROVE)?.reviewedBy).toBe('reviewer-smoke');
    });
  });

  it('[action:reject] rejects a queued case with a reason', async () => {
    renderRoute();
    await openCase(CASE_TO_REJECT);

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    step('action:reject', () => {
      expect(within(dialog).getByText('Reject Verification')).toBeInTheDocument();
    });

    // Rejecting requires a reason for the applicant.
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), {
      target: { value: 'Document appears fraudulent' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));

    await waitFor(() => {
      step('action:reject', () => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    await waitFor(() => {
      step('action:reject', () => {
        const row = screen.getByRole('button', { name: `Verification ${CASE_TO_REJECT}` });
        expect(within(row).getByText('Rejected')).toBeInTheDocument();
      });
    });

    step('action:reject', () => {
      const posted = requestsTo('POST', `/v1/verification-inbox/${CASE_TO_REJECT}/reject`);
      expect(posted).toHaveLength(1);
      expect(posted[0].body).toMatchObject({ rejectionReason: 'Document appears fraudulent' });
      expect(backend.item(CASE_TO_REJECT)?.status).toBe('rejected');
      expect(backend.item(CASE_TO_REJECT)?.rejectionReason).toBe('Document appears fraudulent');
    });
  });
});
