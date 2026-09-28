import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const MOCK_API_HEADERS = { 'access-control-allow-origin': '*' };

const LIGHT_TILE = `
  <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect width="256" height="256" fill="#e8eef2" />
  </svg>
`;

const DARK_TILE = `
  <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect width="256" height="256" fill="#19232d" />
  </svg>
`;

async function setUpDashboard(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(selectedTheme => {
    window.localStorage.setItem('soter-theme', selectedTheme);
  }, theme);

  await page.route(/^http:\/\/localhost:4000\/api\/v1\/config\/version\?platform=web$/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: MOCK_API_HEADERS,
      body: JSON.stringify({
        platform: 'web',
        currentVersion: '1.4.0',
        latestVersion: '1.4.0',
        minRequiredVersion: '1.4.0',
        forceUpgrade: false,
        releaseNotes: { version: '1.4.0', title: 'Current release', changes: [] },
      }),
    }),
  );

  await page.route('http://localhost:4000/analytics/map-data', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: MOCK_API_HEADERS,
      body: JSON.stringify([]),
    }),
  );

  await page.route(/^http:\/\/localhost:4000\/api\/v1\/notifications\/activity-feed\?limit=30$/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: MOCK_API_HEADERS,
      body: JSON.stringify({ success: true, data: [] }),
    }),
  );

  await page.route('http://localhost:4000/api/v1/analytics/global-stats', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: MOCK_API_HEADERS,
      body: JSON.stringify({
        activeCampaigns: 6,
        totalAidDisbursed: 87500,
        totalRecipients: 8,
        byToken: [],
        byRegion: [],
        timeSeries: [],
        computedAt: '2026-01-01T00:00:00.000Z',
      }),
    }),
  );

  await page.route('http://localhost:4000/api/v1/aid/packages**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: MOCK_API_HEADERS,
      body: JSON.stringify({
        data: [
          {
            id: 'AID-001',
            title: 'Emergency Food Supplies',
            region: 'Eastern Region',
            amount: '12,500 USDC',
            recipients: 240,
            status: 'Active',
            token: 'USDC',
          },
          {
            id: 'AID-002',
            title: 'Clean Water Access',
            region: 'Northern Zone',
            amount: '8,000 XLM',
            recipients: 180,
            status: 'Claimed',
            token: 'XLM',
          },
          {
            id: 'AID-003',
            title: 'Community Health Kits',
            region: 'Coastal District',
            amount: '5,400 EURC',
            recipients: 120,
            status: 'Expired',
            token: 'EURC',
          },
        ],
        total: 3,
        page: 1,
        size: 10,
        totalPages: 1,
      }),
    }),
  );

  await page.route(
    /^https:\/\/(?:[abc]\.)?(?:tile\.openstreetmap\.org|basemaps\.cartocdn\.com)\//,
    route =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        headers: MOCK_API_HEADERS,
        body: theme === 'dark' ? DARK_TILE : LIGHT_TILE,
      }),
  );

  await page.goto('/en/dashboard');
  await expect(page.getByRole('heading', { name: 'Aid Dashboard' })).toBeVisible();
  await expect(page.locator(`[data-theme="${theme}"]`)).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading dashboard summary' })).toHaveCount(0);
  await expect(page.getByText('Loading live map data…')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Aid Packages' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Emergency Food Supplies' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Backend status: Healthy' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

for (const theme of ['light', 'dark'] as const) {
  test(`dashboard ${theme} theme matches its visual baseline`, async ({ page }) => {
    await setUpDashboard(page, theme);
    await expect(page).toHaveScreenshot(`dashboard-${theme}.png`, {
      fullPage: true,
      stylePath: path.resolve(process.cwd(), 'tests/visual/dashboard.screenshot.css'),
    });
  });
}
