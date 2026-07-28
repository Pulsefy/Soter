import { DeepLinkTarget } from '../services/notificationService';

export type RootStackParamList = {
  Home: undefined;
  Health: undefined;
  AidOverview: undefined;
  AidDetails: { aidId: string };
  EvidenceUpload: { aidId: string };
  ClaimReceipt: { claimId: string };
  Settings: undefined;
  Scanner: undefined;
  BulkScanner: undefined;
  TaskList: undefined;
  SubmissionQueue: undefined;
};

/** Mapping from deep-link screen names to React Navigation route names */
export const DEEP_LINK_SCREEN_MAP: Record<string, keyof RootStackParamList> = {
  AidDetails: 'AidDetails',
  ClaimReceipt: 'ClaimReceipt',
  EvidenceUpload: 'EvidenceUpload',
  Settings: 'Settings',
  AidOverview: 'AidOverview',
  TaskList: 'TaskList',
  SubmissionQueue: 'SubmissionQueue',
  Health: 'Health',
};

/**
 * Convert a DeepLinkTarget from a notification payload into the params
 * object that React Navigation expects for the corresponding screen.
 *
 * Returns null if:
 *  - the screen name is not in DEEP_LINK_SCREEN_MAP, or
 *  - a required route param (e.g. aidId, claimId) is missing or empty.
 */
export function deepLinkToNavParams(
  target: DeepLinkTarget,
): { screen: keyof RootStackParamList; params: RootStackParamList[keyof RootStackParamList] } | null {
  const screen = DEEP_LINK_SCREEN_MAP[target.screen];
  if (!screen) return null;

  switch (screen) {
    case 'AidDetails': {
      const aidId = target.params?.aidId;
      if (!aidId) return null;
      return { screen, params: { aidId } };
    }
    case 'ClaimReceipt': {
      const claimId = target.params?.claimId;
      if (!claimId) return null;
      return { screen, params: { claimId } };
    }
    case 'EvidenceUpload': {
      const aidId = target.params?.aidId;
      if (!aidId) return null;
      return { screen, params: { aidId } };
    }
    // Screens that require no route params
    case 'Settings':
    case 'AidOverview':
    case 'TaskList':
    case 'SubmissionQueue':
    case 'Health':
      return { screen, params: undefined as any };
    default:
      return null;
  }
}
