'use client';

import { useState, useCallback, useRef } from 'react';
import { useBiometricStore } from '@/lib/biometricStore';
import { 
  getBiometricStatus, 
  promptBiometricAuthentication,
  BiometricAuthResult,
  BiometricStatus 
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
  /** Check biometric availability (updates store) */
  checkAvailability: () => Promise<BiometricStatus>;
  /** Manually trigger biometric authentication */
  authenticate: (reason?: string) => Promise<BiometricAuthResult>;
}

/**
 * Hook for biometric authentication gate that protects high-risk actions.
 * 
 * Features:
 * - Checks biometric availability
 * - Triggers biometric authentication when available
 * - Falls back to confirmation dialog when biometrics unavailable
 * - Manages loading states
 * - Integrates with toast notifications
 * 
 * Example usage:
 * ```tsx
 * const { confirmBeforeAction, isLoading } = useBiometricGate();
 * 
 * const handleDelete = async () => {
 *   await confirmBeforeAction(async () => {
 *     await deleteRecord();
 *   }, {
 *     reason: 'Delete sensitive record',
 *     fallbackMessage: 'Biometric authentication is unavailable. Continue with standard confirmation?'
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
    setStatus,
    setLastAuthResult,
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
   * Manually trigger biometric authentication
   */
  const authenticate = useCallback(async (reason?: string): Promise<BiometricAuthResult> => {
    setIsLoading(true);
    try {
      const result = await promptBiometricAuthentication({ 
        reason: reason || 'Confirm your identity' 
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
  }, [setLastAuthResult, toast]);

  /**
   * Core function: confirm before executing high-risk action
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
    }
  ): Promise<T> => {
    const {
      reason = 'Confirm this high-risk action',
      requireBiometrics = true,
      onAuthStart,
      onAuthComplete,
      fallbackMessage = 'Biometric authentication is unavailable on this device. Do you want to continue with standard confirmation?',
      fallbackTitle = 'Confirm Action'
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
        userPreference !== 'disabled';

      if (shouldUseBiometrics) {
        // Biometric authentication flow
        onAuthStart?.();
        const authResult = await authenticate(reason);
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
  }, [status, checkAvailability, userPreference, authenticate]);

  return {
    status,
    isLoading,
    lastAuthResult,
    checkAvailability,
    confirmBeforeAction,
    authenticate
  };
}