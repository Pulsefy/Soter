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
  /** Update biometric status */
  setStatus: (status: BiometricStatus) => void;
  /** Update last authentication result */
  setLastAuthResult: (result: BiometricAuthResult) => void;
  /** Update user preference */
  setUserPreference: (preference: 'enabled' | 'disabled' | 'ask') => void;
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
      
      setStatus: (status) => set({ status }),
      
      setLastAuthResult: (result) => set({ 
        lastAuthResult: result,
        lastAuthAttempt: new Date()
      }),
      
      setUserPreference: (preference) => set({ userPreference: preference }),
      
      reset: () => set({ 
        status: 'unknown',
        lastAuthResult: null,
        lastAuthAttempt: null,
        // Don't reset user preference as it's a persistent choice
      }),
    }),
    {
      name: 'biometric-storage',
      partialize: (state) => ({
        userPreference: state.userPreference,
        // Don't persist status or auth results as they're session-specific
      }),
    }
  )
);