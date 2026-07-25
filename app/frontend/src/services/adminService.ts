/**
 * Admin service with biometric protection for high-risk actions.
 * 
 * This service wraps admin operations with biometric authentication
 * using the useBiometricGate hook pattern.
 * 
 * Note: In a real implementation, this would be a hook or context-based service.
 * For MVP, we provide this as a utility that can be used with the biometric gate.
 */

import { rotateKey, revokeKey, createKey, getKeys } from './apiKeyService';
import { BiometricGate } from '@/hooks/useBiometricGate';

export interface BiometricProtectedAdminService {
  /** Get API keys (low-risk, no biometric required) */
  getKeys: typeof getKeys;
  /** Rotate API key (high-risk, requires biometric confirmation) */
  rotateKey: (id: string, biometricGate: BiometricGate) => Promise<void>;
  /** Revoke API key (high-risk, requires biometric confirmation) */
  revokeKey: (id: string, biometricGate: BiometricGate) => Promise<void>;
  /** Create new API key (medium-risk, may require confirmation) */
  createKey: (biometricGate?: BiometricGate) => Promise<ReturnType<typeof createKey>>;
}

/**
 * Create a protected admin service instance.
 * 
 * Example usage:
 * ```tsx
 * const biometricGate = useBiometricGate();
 * const adminService = createProtectedAdminService();
 * 
 * const handleRevoke = async (keyId: string) => {
 *   await adminService.revokeKey(keyId, biometricGate);
 * };
 * ```
 */
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
          fallbackTitle: 'Rotate API Key'
        }
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
          highRisk: true
        }
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
            requireBiometrics: false // Creation is lower risk than revocation
          }
        );
      } else {
        // No biometric gate provided, proceed with standard confirmation
        const shouldContinue = window.confirm(
          'Create new API key?\n\nThis will generate new credentials with access to the system.'
        );
        
        if (!shouldContinue) {
          throw new Error('Action cancelled by user');
        }
        
        return createKey();
      }
    }
  };
}