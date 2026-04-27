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
};

/** Mapping from deep-link screen names to React Navigation route names */
export const DEEP_LINK_SCREEN_MAP: Record<string, keyof RootStackParamList> = {
  AidDetails: 'AidDetails',
  ClaimReceipt: 'ClaimReceipt',
  Settings: 'Settings',
  AidOverview: 'AidOverview',
};

/**
 * Convert a DeepLinkTarget from a notification payload into the params
 * object that React Navigation expects for the corresponding screen.
 */
export function deepLinkToNavParams(
  target: DeepLinkTarget,
): { screen: keyof RootStackParamList; params: RootStackParamList[keyof RootStackParamList] } | null {
  const screen = DEEP_LINK_SCREEN_MAP[target.screen];
  if (!screen) return null;

  switch (screen) {
    case 'AidDetails':
      return { screen, params: { aidId: target.params?.aidId ?? '' } };
    case 'ClaimReceipt':
      return { screen, params: { claimId: target.params?.claimId ?? '' } };
    default:
      return { screen, params: undefined as any };
  }
}
