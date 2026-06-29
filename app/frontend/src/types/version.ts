export interface ReleaseNote {
  version: string;
  title: string;
  changes: string[];
}

export interface VersionConfig {
  currentVersion: string;
  latestVersion: string;
  forceUpgrade: boolean;
  releaseNotes: ReleaseNote;
  minRequiredVersion?: string;
}

export interface VersionState {
  currentVersion: string;
  latestVersion: string;
  forceUpgradeRequired: boolean;
  releaseNotes: ReleaseNote | null;
  lastSeenVersion: string | null;
  shouldShowReleaseNotes: boolean;
  setLastSeenVersion: (version: string) => void;
  setShouldShowReleaseNotes: (show: boolean) => void;
  setVersionConfig: (config: VersionConfig) => void;
}