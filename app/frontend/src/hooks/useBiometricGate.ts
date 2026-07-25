'use client';

import { useState, useCallback, useRef } from 'react';
import { useBiometricStore } from '@/lib/biometricStore';
import {
  getBiometricStatus,
  promptBiometricAuthentication,
  registerPasskey,
  BiometricAuthResult,
  BiometricStatus,
} from '@/services/biometricService';
import { useToast } from '@/components/ToastProvider';

export interface BiometricGateOptions {
  /** Reason shown to user during biometric prompt */
  reason?: string;
  /** Whether to require biometrics (if available) */
  requireBiometrics?: boolean;
  /** Callback when biometric authentication starts */
  onAuthStart?: () => void;
  /** Callback when biometric authentication completes */
  onAuthComplete?: (result: BiometricAuthResult) => void;
  /** Custom message for fallback confirmation dialog */
  fallbackMessage?: string;
  /** Title for fallback confirmation dialog */
  fallbackTitle?: string;
  /** Whether this is a high-risk action */
  highRisk?: boolean;
  /** Email for WebAuthn authentication (required for real WebAuthn flow) */
  email?: string;
}

export interface BiometricGate {
  /** Confirm before executing a high-risk action */
  confirmBeforeAction: <T>(
    action: () => Promise<T> | T,
    options?: BiometricGateOptions
  ) => Promise<T>;
}

export interface UseBiometricGateReturn extends BiometricGate {
  /** Current biometric availability status */
  status: BiometricStatus;
  /** Whether biometric check is in progress */
  isLoading: boolean;
  /** Last authentication result */
  lastAuthResult: BiometricAuthResult | null;
  /** Whether the user has a registered passkey */
  hasRegisteredPasskey: boolean;
  /** Check biometric availability (updates store) */
  checkAvailability: () => Promise<BiometricStatus>;
  /** Manually trigger biometric authentication */
  authenticate: (reason?: string, email?: string) => Promise<BiometricAuthResult>;
  /** Register a new passkey (one-time WebAuthn registration) */
  register: (email: string, label?: string) => Promise<boolean>;
}

/**
 * Hook for WebAuthn-based biometric authentication gate that protects high-risk actions.
 *
 * Features:
 * - Checks WebAuthn platform authenticator availability
 * - Supports passkey registration (one-time setup)
 * - Triggers biometric authentication via navigator.credentials.get()
 * - Falls back to confirmation dialog when biometrics unavailable or no passkey registered
 * - Manages loading states
 * - Integrates with toast notifications
 *
 * Example usage:
 * ```tsx
 * const { confirmBeforeAction, register, hasRegisteredPasskey, isLoading } = useBiometricGate();
 *
 * // First-time setup: register a passkey
 * if (!hasRegisteredPasskey) {
 *   await register(user.email, 'My Laptop');
 * }
 *
 * // Then protect high-risk actions
 * const handleDelete = async () => {
 *   await confirmBeforeAction(async () => {
 *     await deleteRecord();
 *   }, {
 *     reason: 'Delete sensitive record',
 *     email: user.email,
 *     fallbackMessage: 'Biometric auth unavailable. Continue?'
 *   });
 * };
 * ```
 */
export function useBiometricGate(): UseBiometricGateReturn {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const {
    status,
    lastAuthResult,
    hasRegisteredPasskey,
    registeredEmail,
    setStatus,
    setLastAuthResult,
    setHasRegisteredPasskey,
    userPreference
  } = useBiometricStore();

  // Ref to track if a confirmation modal is open
  const isConfirmingRef = useRef(false);

  /**
   * Check biometric availability and update store
   */
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

  /**
   * Register a new WebAuthn passkey for a user.
   * This triggers navigator.credentials.create() in the browser.
   */
  const register = useCallback(async (
    email: string,
    label?: string,
  ): Promise<boolean> => {
    setIsLoading(true);
    try {
      const result = await registerPasskey(email, label);
      if (result.success) {
        setHasRegisteredPasskey(true, email);
        toast('Passkey registered', result.message, 'success');
        return true;
      } else {
        toast('Registration failed', result.message, 'error');
        return false;
      }
    } catch (error) {
      console.error('Passkey registration error:', error);
      toast(
        'Registration error',
        error instanceof Error ? error.message : 'Failed to register passkey',
        'error',
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [setHasRegisteredPasskey, toast]);

  /**
   * Manually trigger biometric authentication via WebAuthn.
   */
  const authenticate = useCallback(async (
    reason?: string,
    email?: string,
  ): Promise<BiometricAuthResult> => {
    setIsLoading(true);
    try {
      const result = await promptBiometricAuthentication({
        reason: reason || 'Confirm your identity',
        email: email ?? registeredEmail ?? undefined,
      });

      setLastAuthResult(result);

      // Show toast feedback
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
  }, [registeredEmail, setLastAuthResult, toast]);

  /**
   * Core function: confirm before executing high-risk action.
   *
   * Uses WebAuthn biometric authentication when:
   * 1. Platform authenticator is available
   * 2. User has a registered passkey
   * 3. User preference is not 'disabled'
   *
   * Falls back to standard confirmation dialog otherwise.
   */
  const confirmBeforeAction = useCallback(async <T,>(
    action: () => Promise<T> | T,
    options?: {
      reason?: string;
      requireBiometrics?: boolean;
      onAuthStart?: () => void;
      onAuthComplete?: (result: BiometricAuthResult) => void;
      fallbackMessage?: string;
      fallbackTitle?: string;
      email?: string;
    }
  ): Promise<T> => {
    const {
      reason = 'Confirm this high-risk action',
      requireBiometrics = true,
      onAuthStart,
      onAuthComplete,
      fallbackMessage = 'Biometric authentication is unavailable on this device. Do you want to continue with standard confirmation?',
      fallbackTitle = 'Confirm Action',
      email,
    } = options || {};

    // Prevent multiple concurrent confirmations
    if (isConfirmingRef.current) {
      throw new Error('Another confirmation is already in progress');
    }

    isConfirmingRef.current = true;
    setIsLoading(true);

    try {
      // Check biometric availability
      const currentStatus = status === 'unknown' ? await checkAvailability() : status;

      // Determine if we should use biometrics
      const shouldUseBiometrics =
        requireBiometrics &&
        currentStatus === 'available' &&
        hasRegisteredPasskey &&
        userPreference !== 'disabled';

      if (shouldUseBiometrics) {
        // WebAuthn biometric authentication flow
        onAuthStart?.();
        const authResult = await authenticate(reason, email);
        onAuthComplete?.(authResult);

        if (authResult === 'success') {
          // Authentication successful, execute the action
          const result = await action();
          return result;
        } else {
          // Authentication failed or cancelled
          throw new Error(`Biometric authentication ${authResult}`);
        }
      } else {
        // Fallback: Show confirmation dialog (to be implemented by UI component)
        // For now, we'll use a simple confirm dialog
        const shouldContinue = window.confirm(
          `${fallbackTitle}\n\n${fallbackMessage}\n\nAction: ${reason}`
        );

        if (!shouldContinue) {
          throw new Error('Action cancelled by user');
        }

        // User confirmed, execute the action
        const result = await action();
        return result;
      }
    } finally {
      setIsLoading(false);
      isConfirmingRef.current = false;
    }
  }, [status, checkAvailability, hasRegisteredPasskey, userPreference, authenticate]);

  return {
    status,
    isLoading,
    lastAuthResult,
    hasRegisteredPasskey,
    checkAvailability,
    confirmBeforeAction,
    authenticate,
    register,
  };
}
