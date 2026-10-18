/**
 * Integration tests for version management features
 * Tests the complete flow from version check to UI display
 *
 * The network boundary (`VersionService.fetchVersionConfig`) is the only thing
 * stubbed: everything else — the zustand store, the provider and the two
 * screens — is the real implementation. Without the stub the provider's mount
 * fetch falls back to DEFAULT_VERSION_CONFIG and overwrites the store, which
 * made every assertion below describe a different app state than the one under
 * test.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useVersionStore, VersionService } from '@/lib/versionStore';
import type { VersionConfig } from '@/types/version';
import { VersionProvider } from '@/components/VersionProvider';
import { QueryProvider } from '@/lib/query-provider';
import { ToastProvider } from '@/components/ToastProvider';
import { ThemeProvider } from '@/components/ThemeProvider';

// Mock child component to simulate app content
const MockAppContent = () => {
  const { currentVersion, latestVersion } = useVersionStore();
  return (
    <div data-testid="app-content">
      <h1>Mock Soter App</h1>
      <p>Current: {currentVersion}</p>
      <p>Latest: {latestVersion}</p>
    </div>
  );
};

// Test wrapper
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <QueryProvider>
      <ToastProvider>
        <VersionProvider>
          {children}
        </VersionProvider>
      </ToastProvider>
    </QueryProvider>
  </ThemeProvider>
);

/** Canonical backend payload, overridable per scenario. */
function buildVersionConfig(overrides: Partial<VersionConfig> = {}): VersionConfig {
  return {
    platform: 'web',
    currentVersion: '1.5.0',
    latestVersion: '1.5.0',
    minRequiredVersion: '1.5.0',
    forceUpgrade: false,
    releaseNotes: {
      version: '1.5.0',
      title: "What's New",
      changes: ['Test feature'],
      continueLabel: 'Continue',
      changelogUrl: 'https://example.com/changelog',
    },
    forceUpgradeScreen: {
      title: 'Upgrade Required',
      message: 'Please update to continue',
      updateLabel: 'Update App',
    },
    storeUrl: { web: 'https://soter.app/download' },
    ...overrides,
  };
}

describe('Version Management Integration', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });

    // Clear localStorage before each test
    localStorage.clear();

    // The persisted slice is the only state the tests seed by hand; the rest of
    // the store is always derived from the config the provider loads.
    useVersionStore.setState({ lastSeenVersion: null, shouldShowReleaseNotes: false });

    jest
      .spyOn(VersionService, 'fetchVersionConfig')
      .mockResolvedValue(buildVersionConfig());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should show app content when version is up to date', async () => {
    // Setup: Force upgrade off, versions match
    useVersionStore.setState({ lastSeenVersion: '1.5.0' });

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Should show app content immediately
    expect(await screen.findByTestId('app-content')).toBeInTheDocument();
    expect(screen.getByText(/Current: 1\.5\.0/i)).toBeInTheDocument();
    expect(screen.queryByText(/What's New/i)).not.toBeInTheDocument();
  });

  it('should show force upgrade screen when forceUpgradeRequired is true', async () => {
    // Setup: Force upgrade enabled
    jest
      .spyOn(VersionService, 'fetchVersionConfig')
      .mockResolvedValue(
        buildVersionConfig({
          currentVersion: '1.4.0',
          latestVersion: '1.5.0',
          minRequiredVersion: '1.5.0',
          forceUpgrade: true,
        }),
      );

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Should show force upgrade screen
    expect(await screen.findByRole('heading', { name: /Upgrade Required/i })).toBeInTheDocument();
    expect(screen.getByText(/Update App/i)).toBeInTheDocument();
    // Should NOT show app content
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();
  });

  it('should show release notes modal when new version is available', async () => {
    // Setup: New version available, not seen before
    jest
      .spyOn(VersionService, 'fetchVersionConfig')
      .mockResolvedValue(
        buildVersionConfig({ currentVersion: '1.4.0', latestVersion: '1.5.0' }),
      );

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Should show release notes modal
    expect(
      await screen.findByRole('heading', { name: "What's New" }),
    ).toBeInTheDocument();
    // Exact text: the modal also renders an sr-only "...#{version}" description.
    expect(screen.getByText('Version 1.5.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeInTheDocument();

    // App content should be in background (not blocked)
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });

  it('should store seen version when continue is clicked', async () => {
    jest
      .spyOn(VersionService, 'fetchVersionConfig')
      .mockResolvedValue(
        buildVersionConfig({ currentVersion: '1.4.0', latestVersion: '1.5.0' }),
      );

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Find and click Continue button
    const continueButton = await screen.findByRole('button', { name: /Continue/i });
    fireEvent.click(continueButton);

    // Should update store
    await waitFor(() => {
      const state = useVersionStore.getState();
      expect(state.lastSeenVersion).toBe('1.5.0');
      expect(state.shouldShowReleaseNotes).toBe(false);
    });
  });

  it('should prioritize force upgrade over release notes', async () => {
    // Setup: Both force upgrade and release notes should be shown
    // But force upgrade takes priority
    jest
      .spyOn(VersionService, 'fetchVersionConfig')
      .mockResolvedValue(
        buildVersionConfig({
          currentVersion: '1.4.0',
          latestVersion: '1.5.0',
          forceUpgrade: true,
        }),
      );

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Should show force upgrade screen, NOT release notes
    expect(await screen.findByRole('heading', { name: /Upgrade Required/i })).toBeInTheDocument();
    expect(screen.queryByText(/What's New/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();
  });

  it('should show release notes again for newer version', async () => {
    // Setup: Seen version 1.5.0, new version 1.6.0 available
    useVersionStore.setState({ lastSeenVersion: '1.5.0' });
    jest
      .spyOn(VersionService, 'fetchVersionConfig')
      .mockResolvedValue(
        buildVersionConfig({
          currentVersion: '1.5.0',
          latestVersion: '1.6.0',
          releaseNotes: {
            version: '1.6.0',
            title: "What's New",
            changes: ['New feature'],
            continueLabel: 'Continue',
            changelogUrl: 'https://example.com/changelog',
          },
        }),
      );

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Should show release notes for new version
    expect(
      await screen.findByRole('heading', { name: "What's New" }),
    ).toBeInTheDocument();
    expect(screen.getByText('Version 1.6.0')).toBeInTheDocument();
  });
});
