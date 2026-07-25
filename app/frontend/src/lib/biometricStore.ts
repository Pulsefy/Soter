import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BiometricStatus, BiometricAuthResult } from '@/services/biometricService';

interface BiometricState {
  /** Current biometric availability status */
  status: BiometricStatus;
  /** Last authentication result */
  lastAuthResult: BiometricAuthResult | null;
  /** Timestamp of last authentication attempt */
  lastAuthAttempt: Date | null;
  /** Whether user has opted to use biometrics when available */
  userPreference: 'enabled' | 'disabled' | 'ask';
  /** Whether the user has at least one registered passkey */
  hasRegisteredPasskey: boolean;
  /** Email of the user whose passkeys are registered (for authentication calls) */
  registeredEmail: string | null;
  /** Update biometric status */
  setStatus: (status: BiometricStatus) => void;
  /** Update last authentication result */
  setLastAuthResult: (result: BiometricAuthResult) => void;
  /** Update user preference */
  setUserPreference: (preference: 'enabled' | 'disabled' | 'ask') => void;
  /** Mark that a passkey has been registered */
  setHasRegisteredPasskey: (value: boolean, email?: string) => void;
  /** Reset biometric state (logout, clear session) */
  reset: () => void;
}

export const useBiometricStore = create<BiometricState>()(
  persist(
    (set) => ({
      status: 'unknown',
      lastAuthResult: null,
      lastAuthAttempt: null,
      userPreference: 'ask',
      hasRegisteredPasskey: false,
      registeredEmail: null,

      setStatus: (status) => set({ status }),

      setLastAuthResult: (result) => set({
        lastAuthResult: result,
        lastAuthAttempt: new Date()
      }),

      setUserPreference: (preference) => set({ userPreference: preference }),

      setHasRegisteredPasskey: (value, email) => set({
        hasRegisteredPasskey: value,
        registeredEmail: email ?? null,
      }),

      reset: () => set({
        status: 'unknown',
        lastAuthResult: null,
        lastAuthAttempt: null,
        hasRegisteredPasskey: false,
        registeredEmail: null,
        // Don't reset user preference as it's a persistent choice
      }),
    }),
    {
      name: 'biometric-storage',
      partialize: (state) => ({
        userPreference: state.userPreference,
        hasRegisteredPasskey: state.hasRegisteredPasskey,
        registeredEmail: state.registeredEmail,
        // Don't persist status or auth results as they're session-specific
      }),
    }
  )
);
