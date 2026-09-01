'use client';

import { useState, useCallback, useRef } from 'react';
import { useBiometricStore } from '@/lib/biometricStore';
import {
  getBiometricStatus,
  promptBiometricAuthentication,
  BiometricAuthResult,
  BiometricStatus,
} from '@/services/biometricService';
import { useToast } from '@/components/ToastProvider';

export interface BiometricGateOptions {
  reason?: string;
  requireBiometrics?: boolean;
  onAuthStart?: () => void;
  onAuthComplete?: (result: BiometricAuthResult) => void;
  fallbackMessage?: string;
  fallbackTitle?: string;
  highRisk?: boolean;
  userId?: string;
  /**
   * Controls how the hook behaves when biometrics are unavailable.
   *   - "auto"         (default) → show window.confirm for backward compat
   *   - "external-ui"  → caller already rendered <BiometricConfirmationModal/>,
   *                      so skip the inner confirm and trust the outer UI
   *   - "skip"         → no confirmation at all (only for truly low-risk ops)
   */
  fallbackMode?: 'auto' | 'external-ui' | 'skip';
  /**
   * Custom fallback resolver. When provided, replaces window.confirm with
   * a caller-supplied async confirmation (e.g. controlled React modal).
   * Returning true executes the action; false cancels.
   */
  fallbackResolver?: (opts: {
    title: string;
    message: string;
    reason: string;
    highRisk: boolean;
  }) => Promise<boolean> | boolean;
}

export interface BiometricGate {
  confirmBeforeAction: <T>(
    action: () => Promise<T> | T,
    options?: BiometricGateOptions,
  ) => Promise<T>;
}

export interface UseBiometricGateReturn extends BiometricGate {
  status: BiometricStatus;
  isLoading: boolean;
  lastAuthResult: BiometricAuthResult | null;
  checkAvailability: () => Promise<BiometricStatus>;
  authenticate: (reason?: string, userId?: string) => Promise<BiometricAuthResult>;
}

export function useBiometricGate(): UseBiometricGateReturn {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const {
    status,
    lastAuthResult,
    setStatus,
    setLastAuthResult,
    userPreference,
  } = useBiometricStore();

  const isConfirmingRef = useRef(false);

  const checkAvailability = useCallback(async (): Promise<BiometricStatus> => {
    setIsLoading(true);
    try {
      const newStatus = await getBiometricStatus();
      setStatus(newStatus);
      return newStatus;
    } catch (error) {
      console.error('Error checking biometric availability:', error);
      setStatus('unknown');
      return 'unknown';
    } finally {
      setIsLoading(false);
    }
  }, [setStatus]);

  const authenticate = useCallback(async (reason?: string, userId?: string): Promise<BiometricAuthResult> => {
    setIsLoading(true);
    try {
      const result = await promptBiometricAuthentication({
        reason: reason || 'Confirm your identity',
        userId,
      });

      setLastAuthResult(result);

      if (result === 'success') {
        toast('Authentication successful', 'Biometric verification completed', 'success');
      } else if (result === 'failed') {
        toast('Authentication failed', 'Biometric verification failed. Please try again.', 'error');
      } else if (result === 'cancelled') {
        toast('Authentication cancelled', 'Biometric verification was cancelled', 'warning');
      }

      return result;
    } catch (error) {
      console.error('Biometric authentication error:', error);
      toast('Authentication error', 'An error occurred during biometric verification', 'error');
      setLastAuthResult('error');
      return 'error';
    } finally {
      setIsLoading(false);
    }
  }, [setLastAuthResult, toast]);

  const confirmBeforeAction = useCallback(async <T,>(
    action: () => Promise<T> | T,
    options?: BiometricGateOptions,
  ): Promise<T> => {
    const {
      reason = 'Confirm this high-risk action',
      requireBiometrics = true,
      onAuthStart,
      onAuthComplete,
      fallbackMessage = 'Biometric authentication is unavailable on this device. Do you want to continue with standard confirmation?',
      fallbackTitle = 'Confirm Action',
      highRisk = false,
      userId,
      fallbackMode = 'auto',
      fallbackResolver,
    } = options || {};

    if (isConfirmingRef.current) {
      throw new Error('Another confirmation is already in progress');
    }

    isConfirmingRef.current = true;
    setIsLoading(true);

    try {
      const currentStatus: BiometricStatus = status === 'unknown' ? await checkAvailability() : status;

      const shouldUseBiometrics =
        requireBiometrics &&
        currentStatus === 'available' &&
        userPreference !== 'disabled';

      if (shouldUseBiometrics) {
        onAuthStart?.();
        const authResult = await authenticate(reason, userId);
        onAuthComplete?.(authResult);

        if (authResult === 'success') {
          return await action();
        }
        throw new Error(`Biometric authentication ${authResult}`);
      }

      // Fallback path when biometrics unavailable or disabled.
      if (fallbackMode === 'skip') {
        return await action();
      }

      if (fallbackMode === 'external-ui') {
        // The outer component (e.g. AdminApiKeyManager) already rendered
        // <BiometricConfirmationModal /> and the user has already clicked
        // "Continue" before we reach this point. No second confirmation.
        return await action();
      }

      if (fallbackResolver) {
        const confirmed = await Promise.resolve(
          fallbackResolver({ title: fallbackTitle, message: fallbackMessage, reason, highRisk }),
        );
        if (!confirmed) throw new Error('Action cancelled by user');
        return await action();
      }

      // Default: safe window.confirm fallback for contexts with no UI wrapper.
      const shouldContinue = window.confirm(
        `${fallbackTitle}\n\n${fallbackMessage}\n\nAction: ${reason}`,
      );
      if (!shouldContinue) throw new Error('Action cancelled by user');
      return await action();
    } finally {
      setIsLoading(false);
      isConfirmingRef.current = false;
    }
  }, [status, checkAvailability, userPreference, authenticate]);

  return {
    status,
    isLoading,
    lastAuthResult,
    checkAvailability,
    confirmBeforeAction,
    authenticate,
  };
}
