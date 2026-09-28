/**
 * Admin service with biometric protection for high-risk actions.
 *
 * Uses WebAuthn-based biometric flow from biometricService (via
 * useBiometricGate). The AdminApiKeyManager component wraps these
 * calls in a <BiometricConfirmationModal/>, so when the hook falls
 * back from biometrics (unsupported browser / unenrolled device),
 * we tell the hook to trust the outer modal and not ask again.
 */

import { rotateKey, revokeKey, createKey, getKeys } from './apiKeyService';
import { BiometricGate } from '@/hooks/useBiometricGate';

export interface BiometricProtectedAdminService {
  getKeys: typeof getKeys;
  rotateKey: (id: string, biometricGate: BiometricGate) => Promise<void>;
  revokeKey: (id: string, biometricGate: BiometricGate) => Promise<void>;
  createKey: (biometricGate?: BiometricGate) => Promise<ReturnType<typeof createKey>>;
}

export function createProtectedAdminService(): BiometricProtectedAdminService {
  return {
    getKeys,

    async rotateKey(id: string, biometricGate: BiometricGate): Promise<void> {
      if (!biometricGate || !biometricGate.confirmBeforeAction) {
        throw new Error('Biometric gate required for high-risk actions');
      }

      await biometricGate.confirmBeforeAction(
        async () => {
          await rotateKey(id);
        },
        {
          reason: 'Rotate API key',
          fallbackMessage: 'Rotating an API key will invalidate the current key and generate a new one. This action cannot be undone.',
          fallbackTitle: 'Rotate API Key',
          fallbackMode: 'external-ui',
        },
      );
    },

    async revokeKey(id: string, biometricGate: BiometricGate): Promise<void> {
      if (!biometricGate || !biometricGate.confirmBeforeAction) {
        throw new Error('Biometric gate required for high-risk actions');
      }

      await biometricGate.confirmBeforeAction(
        async () => {
          await revokeKey(id);
        },
        {
          reason: 'Revoke API key',
          fallbackMessage: 'Revoking an API key will permanently disable it. This action cannot be undone.',
          fallbackTitle: 'Revoke API Key',
          highRisk: true,
          fallbackMode: 'external-ui',
        },
      );
    },

    async createKey(biometricGate?: BiometricGate): Promise<ReturnType<typeof createKey>> {
      if (biometricGate?.confirmBeforeAction) {
        return biometricGate.confirmBeforeAction(
          async () => {
            return createKey();
          },
          {
            reason: 'Create new API key',
            fallbackMessage: 'Creating a new API key will generate credentials with access to the system.',
            fallbackTitle: 'Create API Key',
            requireBiometrics: false,
          },
        );
      }

      const shouldContinue = window.confirm(
        'Create new API key?\n\nThis will generate new credentials with access to the system.',
      );
      if (!shouldContinue) throw new Error('Action cancelled by user');
      return createKey();
    },
  };
}
