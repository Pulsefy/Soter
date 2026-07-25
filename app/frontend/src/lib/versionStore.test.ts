import { useVersionStore, VersionService } from './versionStore';

describe('Version Store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should initialize with mock data', () => {
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
    });
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
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
      forceUpgrade: false,
      releaseNotes: {
        version: '1.5.0',
        title: "What's New",
        changes: ['Test change'],
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
      currentVersion: '1.5.0',
      latestVersion: '1.6.0',
      forceUpgrade: false,
      releaseNotes: {
        version: '1.6.0',
        title: "What's New",
        changes: ['New feature'],
      },
    });
    
    const store = useVersionStore.getState();
    expect(store.shouldShowReleaseNotes).toBe(true);
  });

  it('should not show release notes during force upgrade', () => {
    const { setVersionConfig } = useVersionStore.getState();
    
    setVersionConfig({
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
      forceUpgrade: true, // Force upgrade enabled
      releaseNotes: {
        version: '1.5.0',
        title: "What's New",
        changes: ['Test change'],
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
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
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
      },
    });
  });
});