import { useVersionStore, VersionService } from './versionStore';
import { DEFAULT_VERSION_CONFIG } from './defaultVersionConfig';

describe('Version Store', () => {
  beforeEach(() => {
    localStorage.clear();
    useVersionStore.setState({
      platform: DEFAULT_VERSION_CONFIG.platform,
      currentVersion: DEFAULT_VERSION_CONFIG.currentVersion,
      latestVersion: DEFAULT_VERSION_CONFIG.latestVersion,
      minRequiredVersion: DEFAULT_VERSION_CONFIG.minRequiredVersion ?? null,
      forceUpgradeRequired: DEFAULT_VERSION_CONFIG.forceUpgrade,
      releaseNotes: DEFAULT_VERSION_CONFIG.releaseNotes,
      forceUpgradeScreen: DEFAULT_VERSION_CONFIG.forceUpgradeScreen ?? null,
      storeUrl: DEFAULT_VERSION_CONFIG.storeUrl ?? null,
      lastSeenVersion: null,
      shouldShowReleaseNotes: false,
    });
  });

  it('should initialize with default release data', () => {
    const store = useVersionStore.getState();
    expect(store.currentVersion).toBe('1.4.0');
    expect(store.latestVersion).toBe('1.5.0');
    expect(store.forceUpgradeRequired).toBe(false);
    expect(store.releaseNotes).toEqual({
      version: '1.5.0',
      title: "What's New",
      changes: [
        'Improved beneficiary verification',
        'Faster voucher loading',
        'Offline sync improvements',
        'Enhanced security measures',
      ],
      changelogUrl: 'https://soter.app/changelog',
      continueLabel: 'Continue',
    });
    expect(store.forceUpgradeScreen?.title).toBe('Upgrade Required');
    expect(store.storeUrl?.web).toBe('https://soter.app/download');
  });

  it('should set last seen version', () => {
    const { setLastSeenVersion } = useVersionStore.getState();
    setLastSeenVersion('1.5.0');
    
    const store = useVersionStore.getState();
    expect(store.lastSeenVersion).toBe('1.5.0');
  });

  it('should not show release notes if version already seen', () => {
    const { setLastSeenVersion, setVersionConfig } = useVersionStore.getState();
    
    // Mark version 1.5.0 as seen
    setLastSeenVersion('1.5.0');
    
    // Update config with same version
    setVersionConfig({
      platform: 'web',
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
      forceUpgrade: false,
      releaseNotes: {
        version: '1.5.0',
        title: "What's New",
        changes: ['Test change'],
        changelogUrl: 'https://example.com/changelog',
        continueLabel: 'Continue',
      },
    });
    
    const store = useVersionStore.getState();
    expect(store.shouldShowReleaseNotes).toBe(false);
  });

  it('should show release notes for new version', () => {
    const { setLastSeenVersion, setVersionConfig } = useVersionStore.getState();
    
    // Mark version 1.5.0 as seen
    setLastSeenVersion('1.5.0');
    
    // Update config with NEW version 1.6.0
    setVersionConfig({
      platform: 'web',
      currentVersion: '1.5.0',
      latestVersion: '1.6.0',
      forceUpgrade: false,
      releaseNotes: {
        version: '1.6.0',
        title: "What's New",
        changes: ['New feature'],
        changelogUrl: 'https://example.com/changelog',
        continueLabel: 'Continue',
      },
    });
    
    const store = useVersionStore.getState();
    expect(store.shouldShowReleaseNotes).toBe(true);
  });

  it('should not show release notes during force upgrade', () => {
    const { setVersionConfig } = useVersionStore.getState();
    
    setVersionConfig({
      platform: 'web',
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
      forceUpgrade: true, // Force upgrade enabled
      releaseNotes: {
        version: '1.5.0',
        title: "What's New",
        changes: ['Test change'],
        changelogUrl: 'https://example.com/changelog',
        continueLabel: 'Continue',
      },
      forceUpgradeScreen: {
        title: 'Upgrade Required',
        message: 'Update to continue',
      },
    });
    
    const store = useVersionStore.getState();
    expect(store.shouldShowReleaseNotes).toBe(false);
    expect(store.forceUpgradeRequired).toBe(true);
  });

  it('should persist last seen version in localStorage', () => {
    const { setLastSeenVersion } = useVersionStore.getState();
    setLastSeenVersion('1.5.0');
    
    // Simulate reload by clearing memory but keeping localStorage
    localStorage.setItem('version-storage', JSON.stringify({
      state: { lastSeenVersion: '1.5.0' },
      version: 0
    }));
    
    // Get fresh store (simulating new session)
    const freshStore = useVersionStore.getState();
    expect(freshStore.lastSeenVersion).toBe('1.5.0');
  });

  it('should fetch version config from service', async () => {
    const config = await VersionService.fetchVersionConfig();
    expect(config).toEqual({
      platform: 'web',
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
      minRequiredVersion: '1.4.0',
      forceUpgrade: false,
      releaseNotes: {
        version: '1.5.0',
        title: "What's New",
        changes: [
          'Improved beneficiary verification',
          'Faster voucher loading',
          'Offline sync improvements',
          'Enhanced security measures',
        ],
        changelogUrl: 'https://soter.app/changelog',
        continueLabel: 'Continue',
      },
      forceUpgradeScreen: {
        title: 'Upgrade Required',
        message:
          'A newer version of Soter is required before you can continue using the application.',
        details:
          'This upgrade includes critical security updates and new features required for the platform.',
        updateLabel: 'Update App',
        retryLabel: 'Check Again',
        supportUrl: 'https://soter.app/support',
        supportLabel: 'support page',
      },
      storeUrl: {
        ios: 'https://apps.apple.com/app/soter',
        android:
          'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
        web: 'https://soter.app/download',
      },
    });
  });
});
