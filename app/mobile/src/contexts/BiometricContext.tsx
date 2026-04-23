import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  PropsWithChildren,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

const STORAGE_KEY = 'biometric_lock_enabled';

interface BiometricContextValue {
  /** Whether the user has enabled biometric lock in Settings */
  biometricEnabled: boolean;
  /** Whether the device actually supports biometrics */
  biometricSupported: boolean;
  /** Toggle the biometric lock setting */
  toggleBiometric: (value: boolean) => Promise<void>;
  /**
   * Prompt the user for biometric auth.
   * Resolves `true` on success, `false` on failure/cancel.
   */
  authenticate: () => Promise<boolean>;
}

const BiometricContext = createContext<BiometricContextValue | undefined>(
  undefined,
);

export const BiometricProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);

  useEffect(() => {
    const init = async () => {
      const [hasHardware, isEnrolled, stored] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        AsyncStorage.getItem(STORAGE_KEY),
      ]);

      const supported = hasHardware && isEnrolled;
      setBiometricSupported(supported);
      setBiometricEnabled(supported && stored === 'true');
    };

    void init();
  }, []);

  const toggleBiometric = async (value: boolean) => {
    setBiometricEnabled(value);
    await AsyncStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  };

  const authenticate = async (): Promise<boolean> => {
    if (!biometricEnabled) return true;

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to view sensitive details',
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });

    return result.success;
  };

  return (
    <BiometricContext.Provider
      value={{ biometricEnabled, biometricSupported, toggleBiometric, authenticate }}
    >
      {children}
    </BiometricContext.Provider>
  );
};

export const useBiometric = (): BiometricContextValue => {
  const ctx = useContext(BiometricContext);
  if (!ctx) {
    throw new Error('useBiometric must be used within a <BiometricProvider>');
  }
  return ctx;
};
