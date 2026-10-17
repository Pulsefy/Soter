export interface VersionInfo {
  latestVersion: string;
  minRequiredVersion: string;
  releaseNotesVersion: string;
  releaseNotes: string[];
  storeUrl: {
    ios: string;
    android: string;
  };
}

export interface UpdateState {
  isUpdateAvailable: boolean;
  isForceUpgrade: boolean;
  versionInfo: VersionInfo | null;
  hasSeenReleaseNotes: boolean;
}
