export interface ReleaseNote {
  version: string;
  title: string;
  changes: string[];
  changelogUrl?: string;
  continueLabel?: string;
}

export interface ForceUpgradeContent {
  title: string;
  message: string;
  details?: string;
  updateLabel?: string;
  retryLabel?: string;
  supportUrl?: string;
  supportLabel?: string;
}

export interface StoreUrlConfig {
  ios?: string;
  android?: string;
  web?: string;
}

export interface VersionConfig {
  platform?: 'web' | 'ios' | 'android';
  currentVersion: string;
  latestVersion: string;
  forceUpgrade: boolean;
  releaseNotes: ReleaseNote;
  minRequiredVersion?: string;
  forceUpgradeScreen?: ForceUpgradeContent;
  storeUrl?: StoreUrlConfig;
}

export interface VersionState {
  platform?: 'web' | 'ios' | 'android';
  currentVersion: string;
  latestVersion: string;
  minRequiredVersion: string | null;
  forceUpgradeRequired: boolean;
  releaseNotes: ReleaseNote | null;
  forceUpgradeScreen: ForceUpgradeContent | null;
  storeUrl: StoreUrlConfig | null;
  lastSeenVersion: string | null;
  shouldShowReleaseNotes: boolean;
  setLastSeenVersion: (version: string | null) => void;
  setShouldShowReleaseNotes: (show: boolean) => void;
  setVersionConfig: (config: VersionConfig) => void;
}
