import { fetchClient } from './client';

// Mock environment variables
process.env.NEXT_PUBLIC_USE_MOCKS = 'true';
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';

// Mock global fetch
global.fetch = jest.fn();

describe('Mock API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should route to mock handler when mocks are enabled', async () => {
    const fetchPromise = fetchClient('http://localhost:4000/health');

    // Fast-forward time to skip the 500ms delay
    jest.advanceTimersByTime(500);

    const response = await fetchPromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.version).toBe('1.0.0-mock');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should return mock aid packages', async () => {
    const fetchPromise = fetchClient('http://localhost:4000/aid-packages');

    jest.advanceTimersByTime(500);

    const response = await fetchPromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(8);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should handle query parameters correctly', async () => {
    const fetchPromise = fetchClient('http://localhost:4000/aid-packages?status=pending&sort=desc');

    jest.advanceTimersByTime(500);

    const response = await fetchPromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should handle relative URLs', async () => {
    const fetchPromise = fetchClient('/health');

    jest.advanceTimersByTime(500);

    const response = await fetchPromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should use real fetch when no mock handler exists', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response('real response'),
    );

    await fetchClient('http://localhost:4000/unknown-endpoint');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/unknown-endpoint',
      undefined,
    );
  });

  it('should use real fetch when mocks are disabled', async () => {
    process.env.NEXT_PUBLIC_USE_MOCKS = 'false';
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response('real response'),
    );

    await fetchClient('http://localhost:4000/health');

    expect(global.fetch).toHaveBeenCalled();

    // Reset env var
    process.env.NEXT_PUBLIC_USE_MOCKS = 'true';
  });

  // ═══════════════════════════════════════════════════════════════════
  // Verification Inbox Mock Handler Tests
  // ═══════════════════════════════════════════════════════════════════

  describe('Verification Inbox', () => {
    const INBOX_BASE = 'http://localhost:4000/v1/verification-inbox';

    it('returns populated inbox with items and pagination', async () => {
      const fetchPromise = fetchClient(`${INBOX_BASE}`);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.total).toBeGreaterThan(0);
      expect(data.page).toBe(1);
      expect(data.totalPages).toBeGreaterThanOrEqual(1);
      // Check item shape
      const item = data.items[0];
      expect(item.id).toBeDefined();
      expect(item.status).toBeDefined();
      expect(item.createdAt).toBeDefined();
      expect(item.deepLink).toBeDefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('filters inbox by status', async () => {
      const fetchPromise = fetchClient(`${INBOX_BASE}?status=pending_review`);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      for (const item of data.items) {
        expect(item.status).toBe('pending_review');
      }
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('filters inbox by riskLevel', async () => {
      const fetchPromise = fetchClient(`${INBOX_BASE}?riskLevel=high`);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      for (const item of data.items) {
        expect(item.riskLevel).toBe('high');
      }
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns empty items when filter matches nothing', async () => {
      const fetchPromise = fetchClient(
        `${INBOX_BASE}?status=approved&riskLevel=high`,
      );
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.items).toHaveLength(0);
      expect(data.total).toBe(0);
      expect(data.totalPages).toBe(1); // ceil(0/20) = 0 but we use || 1
    });

    it('returns inbox stats with counts by status', async () => {
      const fetchPromise = fetchClient(`${INBOX_BASE}/stats`);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.pending_review).toBeGreaterThanOrEqual(0);
      expect(data.approved).toBeGreaterThanOrEqual(0);
      expect(data.rejected).toBeGreaterThanOrEqual(0);
      expect(data.needs_resubmission).toBeGreaterThanOrEqual(0);
      expect(data.total).toBeGreaterThan(0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns detail for a specific verification item', async () => {
      const fetchPromise = fetchClient(`${INBOX_BASE}/vfy-001`);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBe('vfy-001');
      expect(data.status).toBeDefined();
      expect(data.createdAt).toBeDefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns 404 for non-existent verification item', async () => {
      const fetchPromise = fetchClient(`${INBOX_BASE}/nonexistent`);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;

      expect(res.status).toBe(404);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('approves a pending verification request', async () => {
      const fetchPromise = fetchClient(`${INBOX_BASE}/vfy-001/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nextStepMessage: 'Approved — ready for disbursement',
          internalNote: 'All checks passed',
        }),
      });
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBe('vfy-001');
      expect(data.status).toBe('approved');
      expect(data.reviewedAt).toBeDefined();
      expect(data.reviewedBy).toBe('reviewer-demo');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects a pending verification request', async () => {
      const fetchPromise = fetchClient(`${INBOX_BASE}/vfy-006/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rejectionReason: 'Biometric mismatch',
          nextStepMessage: 'Please retake biometric verification',
        }),
      });
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBe('vfy-006');
      expect(data.status).toBe('rejected');
      expect(data.rejectionReason).toBe('Biometric mismatch');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('requests resubmission for a pending verification', async () => {
      const fetchPromise = fetchClient(
        `${INBOX_BASE}/vfy-008/request-resubmission`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rejectionReason: 'Document expired',
            nextStepMessage: 'Submit a valid ID',
          }),
        },
      );
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBe('vfy-008');
      expect(data.status).toBe('needs_resubmission');
      expect(data.rejectionReason).toBe('Document expired');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns 400 when approving an already processed item', async () => {
      // vfy-003 is already 'approved'
      const fetchPromise = fetchClient(`${INBOX_BASE}/vfy-003/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;

      expect(res.status).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns notes for a verification item', async () => {
      const fetchPromise = fetchClient(`${INBOX_BASE}/vfy-002/notes`);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      // vfy-002 has 2 mock notes
      expect(data.length).toBeGreaterThanOrEqual(1);
      for (const note of data) {
        expect(note.id).toBeDefined();
        expect(note.content).toBeDefined();
        expect(note.authorId).toBeDefined();
      }
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('adds a new note to a verification item', async () => {
      const fetchPromise = fetchClient(`${INBOX_BASE}/vfy-001/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Contacted recipient for additional documents',
          category: 'follow_up',
        }),
      });
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.content).toBe('Contacted recipient for additional documents');
      expect(data.category).toBe('follow_up');
      expect(data.entityType).toBe('verification');
      expect(data.entityId).toBe('vfy-001');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('paginates inbox results', async () => {
      // Use small limit to force pagination
      const fetchPromise = fetchClient(`${INBOX_BASE}?page=1&limit=3`);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.items.length).toBeLessThanOrEqual(3);
      expect(data.page).toBe(1);
      expect(data.limit).toBe(3);
      if (data.total > 3) {
        expect(data.totalPages).toBeGreaterThan(1);
      }
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  it('should create and retrieve campaign with mock API', async () => {
    const createPromise = fetchClient('http://localhost:4000/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Field Support', budget: 12000, metadata: { token: 'USDC', expiry: '2026-10-10' } }),
    });

    jest.advanceTimersByTime(500);

    const createRes = await createPromise;
    const createdJson = await createRes.json();

    expect(createRes.status).toBe(201);
    expect(createdJson.success).toBe(true);
    expect(createdJson.data.name).toBe('Field Support');

    const listPromise = fetchClient('http://localhost:4000/campaigns');
    jest.advanceTimersByTime(500);
    const listRes = await listPromise;
    const listJson = await listRes.json();

    expect(listRes.status).toBe(200);
    expect(
      Array.isArray(listJson.data) &&
        listJson.data.some((campaign: { name: string }) => campaign.name === 'Field Support')
    ).toBe(true);

    const patchPromise = fetchClient(`http://localhost:4000/campaigns/${createdJson.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });

    jest.advanceTimersByTime(500);
    const patchRes = await patchPromise;
    const patchJson = await patchRes.json();

    expect(patchRes.status).toBe(200);
    expect(patchJson.success).toBe(true);
    expect(patchJson.data.status).toBe('paused');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Dashboard Summary (global-stats) Mock Handler Tests
  // ═══════════════════════════════════════════════════════════════════

  describe('Dashboard Summary Cards (/analytics/global-stats)', () => {
    const STATS_URL = 'http://localhost:4000/analytics/global-stats';

    it('returns live totals derived from mock data (not zeros)', async () => {
      const fetchPromise = fetchClient(STATS_URL);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(res.status).toBe(200);
      // The mock data contains 8 inbox items and 8 packages, so totals
      // should be greater than zero.
      expect(data.totalClaims).toBeGreaterThan(0);
      expect(data.totalPackages).toBeGreaterThan(0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns all four required summary fields', async () => {
      const fetchPromise = fetchClient(STATS_URL);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      expect(data).toHaveProperty('totalClaims');
      expect(data).toHaveProperty('totalPackages');
      expect(data).toHaveProperty('pendingReviews');
      expect(data).toHaveProperty('totalDisbursements');
    });

    it('returns finite non-negative numbers for every metric', async () => {
      const fetchPromise = fetchClient(STATS_URL);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      for (const key of ['totalClaims', 'totalPackages', 'pendingReviews', 'totalDisbursements'] as const) {
        expect(typeof data[key]).toBe('number');
        expect(Number.isFinite(data[key])).toBe(true);
        expect(data[key]).toBeGreaterThanOrEqual(0);
      }
    });

    it('reflects pending_review items in pendingReviews count', async () => {
      const fetchPromise = fetchClient(STATS_URL);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      // From the mock inbox items we know there are 4 pending_review entries
      expect(data.pendingReviews).toBeGreaterThan(0);
    });

    it('reflects Claimed packages in totalDisbursements', async () => {
      const fetchPromise = fetchClient(STATS_URL);
      jest.advanceTimersByTime(500);
      const res = await fetchPromise;
      const data = await res.json();

      // From the mock ALL_PACKAGES we know there are 2 Claimed packages
      expect(data.totalDisbursements).toBeGreaterThan(0);
    });
  });
});
