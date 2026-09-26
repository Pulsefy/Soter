import React, {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { AppState } from 'react-native';
import {
  initCrashReporting,
  isCrashReportingEnabled,
  setCrashReportingEnabled,
  flushCrashReports,
} from '../services/crashReporting';

interface CrashReportingContextValue {
  /** Whether crash reporting is currently active. */
  enabled: boolean;
  /** True while the initial preference is being loaded from storage. */
  isLoading: boolean;
  /** Toggle crash reporting on/off. Persists the choice and re-initialises the SDK. */
  toggle: (enabled: boolean) => Promise<void>;
}

const CrashReportingContext = createContext<CrashReportingContextValue>({
  enabled: true,
  isLoading: true,
  toggle: async () => {},
});

/**
 * Provides crash-reporting state to the entire component tree.
 *
 * On mount it:
 *  1. Reads the persisted user preference from AsyncStorage.
 *  2. Initialises the Sentry SDK in the matching enabled/disabled state.
 *  3. Listens for AppState changes to flush queued events when the app is
 *     backgrounded (important for low-connectivity field devices).
 */
export const CrashReportingProvider: React.FC<PropsWithChildren> = ({
  children,
}) => {
  const [enabled, setEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  // Bootstrap: read preference → init SDK
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const preference = await isCrashReportingEnabled();
        if (!mounted) return;
        setEnabled(preference);
        initCrashReporting(preference);
      } catch {
        // If storage read fails, default to enabled
        if (mounted) {
          setEnabled(true);
          initCrashReporting(true);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Flush queued events when the app is about to go to background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'inactive' || nextState === 'background') {
        void flushCrashReports(1500);
      }
    });

    return () => subscription.remove();
  }, []);

  const toggle = useCallback(async (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    await setCrashReportingEnabled(nextEnabled);
  }, []);

  return (
    <CrashReportingContext.Provider value={{ enabled, isLoading, toggle }}>
      {children}
    </CrashReportingContext.Provider>
  );
};

export const useCrashReporting = (): CrashReportingContextValue => {
  return useContext(CrashReportingContext);
};
