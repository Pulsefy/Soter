import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.visual.ts',
  outputDir: './.next/playwright-test-results',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.005,
    },
  },
  use: {
    baseURL,
    browserName: 'chromium',
    colorScheme: 'light',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/start-visual-server.cjs',
    url: `${baseURL}/en/dashboard`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_API_URL: 'http://localhost:4000',
      NEXT_PUBLIC_USE_MOCKS: 'true',
      NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
    },
  },
});
