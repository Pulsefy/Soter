/**
 * Integration tests for version management features
 * Tests the complete flow from version check to UI display
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useVersionStore } from '@/lib/versionStore';
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

describe('Version Management Integration', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  it('should show app content when version is up to date', async () => {
    // Setup: Force upgrade off, versions match
    useVersionStore.setState({
      currentVersion: '1.5.0',
      latestVersion: '1.5.0',
      forceUpgradeRequired: false,
      shouldShowReleaseNotes: false,
      lastSeenVersion: '1.5.0',
    });

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Should show app content immediately
    expect(await screen.findByTestId('app-content')).toBeInTheDocument();
    expect(screen.getByText(/Current: 1\.5\.0/i)).toBeInTheDocument();
  });

  it('should show force upgrade screen when forceUpgradeRequired is true', async () => {
    // Setup: Force upgrade enabled
    useVersionStore.setState({
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
      forceUpgradeRequired: true,
      shouldShowReleaseNotes: false,
    });

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Should show force upgrade screen
    expect(await screen.findByText(/Upgrade Required/i)).toBeInTheDocument();
    expect(screen.getByText(/Update App/i)).toBeInTheDocument();
    // Should NOT show app content
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();
  });

  it('should show release notes modal when new version is available', async () => {
    // Setup: New version available, not seen before
    useVersionStore.setState({
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
      forceUpgradeRequired: false,
      shouldShowReleaseNotes: true,
      lastSeenVersion: null,
      releaseNotes: {
        version: '1.5.0',
        title: "What's New",
        changes: ['Test feature'],
      },
    });

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Should show release notes modal
    expect(await screen.findByText(/What's New/i)).toBeInTheDocument();
    expect(screen.getByText(/Version 1\.5\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/Continue/i)).toBeInTheDocument();
    
    // App content should be in background (not blocked)
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });

  it('should store seen version when continue is clicked', async () => {
    // Setup
    useVersionStore.setState({
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
      forceUpgradeRequired: false,
      shouldShowReleaseNotes: true,
      lastSeenVersion: null,
      releaseNotes: {
        version: '1.5.0',
        title: "What's New",
        changes: ['Test feature'],
      },
    });

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Find and click Continue button
    const continueButton = await screen.findByText(/Continue/i);
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
    useVersionStore.setState({
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
      forceUpgradeRequired: true, // Force upgrade enabled
      shouldShowReleaseNotes: true, // Release notes would show
      releaseNotes: {
        version: '1.5.0',
        title: "What's New",
        changes: ['Test feature'],
      },
    });

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Should show force upgrade screen, NOT release notes
    expect(await screen.findByText(/Upgrade Required/i)).toBeInTheDocument();
    expect(screen.queryByText(/What's New/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();
  });

  it('should show release notes again for newer version', async () => {
    // Setup: Seen version 1.5.0, new version 1.6.0 available
    useVersionStore.setState({
      currentVersion: '1.5.0',
      latestVersion: '1.6.0',
      forceUpgradeRequired: false,
      shouldShowReleaseNotes: true,
      lastSeenVersion: '1.5.0', // Old version seen
      releaseNotes: {
        version: '1.6.0',
        title: "What's New",
        changes: ['New feature'],
      },
    });

    render(
      <TestWrapper>
        <MockAppContent />
      </TestWrapper>
    );

    // Should show release notes for new version
    expect(await screen.findByText(/What's New/i)).toBeInTheDocument();
    expect(screen.getByText(/Version 1\.6\.0/i)).toBeInTheDocument();
  });
});