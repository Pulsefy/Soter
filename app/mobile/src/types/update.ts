export interface VersionInfo {
  latestVersion: string;
  minRequiredVersion: string;
  releaseNotes: string[];
  storeUrl: {
    ios: string;
    android: string;
  };
  gracePeriodMs?: number;
  gracePeriodSeconds?: number;
  deadline?: string | number;
  forceUpgradeDeadline?: string | number;
}

export type UpgradeState = 'none' | 'warn' | 'block';

export interface UpdateState {
  isUpdateAvailable: boolean;
  isForceUpgrade: boolean;
  upgradeState: UpgradeState;
  versionInfo: VersionInfo | null;
  hasSeenReleaseNotes: boolean;
  graceDeadline: number | null;
  remainingGraceMs: number;
}

