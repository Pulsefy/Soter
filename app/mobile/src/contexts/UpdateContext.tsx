import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
} from 'react';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UpdateState } from '../types/update';
import { resolveVersionInfo, compareVersions } from '../services/updateService';
import { structuredLogger } from '../services/logger';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

interface UpdateContextType extends UpdateState {
  markReleaseNotesSeen: () => Promise<void>;
  checkUpdates: () => Promise<void>;
  isLoading: boolean;
}

const UpdateContext = createContext<UpdateContextType | undefined>(undefined);

const SEEN_RELEASE_NOTES_KEY = '@Soter:SeenReleaseNotes';

export const UpdateProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, setState] = useState<UpdateState>({
    isUpdateAvailable: false,
    isForceUpgrade: false,
    versionInfo: null,
    hasSeenReleaseNotes: true,
  });
  const [isLoading, setIsLoading] = useState(true);

  const currentVersion = Constants.expoConfig?.version || '0.0.0';

  const checkUpdates = useCallback(async () => {
    try {
      const { versionInfo, source } = await resolveVersionInfo();

      // No connectivity and no cached policy: fail open rather than blocking
      // a field worker behind an update check that could not run.
      if (!versionInfo) {
        structuredLogger.warn(
          'updates.version_check_offline_no_cache',
          {},
          'updates',
        );
        setState(prev => ({
          ...prev,
          isUpdateAvailable: false,
          isForceUpgrade: false,
        }));
        return;
      }

      if (source === 'cache') {
        structuredLogger.info(
          'updates.version_check_offline_cached',
          { minRequiredVersion: versionInfo.minRequiredVersion },
          'updates',
        );
      }

      const updateAvailable =
        compareVersions(versionInfo.latestVersion, currentVersion) > 0;
      const forceUpgrade =
        compareVersions(versionInfo.minRequiredVersion, currentVersion) > 0;

      let hasSeen = true;
      if (updateAvailable) {
        const storedVersion = await AsyncStorage.getItem(
          SEEN_RELEASE_NOTES_KEY,
        );
        hasSeen = storedVersion === versionInfo.latestVersion;
      }

      setState({
        isUpdateAvailable: updateAvailable,
        isForceUpgrade: forceUpgrade,
        versionInfo,
        hasSeenReleaseNotes: hasSeen,
      });
    } catch (error) {
      structuredLogger.error(
        'updates.check_failed',
        { error: error instanceof Error ? error.message : String(error) },
        'updates',
      );
    } finally {
      setIsLoading(false);
    }
  }, [currentVersion]);

  // Re-run the check as soon as connectivity is restored.
  useNetworkStatus(checkUpdates);

  const markReleaseNotesSeen = async () => {
    if (state.versionInfo) {
      await AsyncStorage.setItem(
        SEEN_RELEASE_NOTES_KEY,
        state.versionInfo.latestVersion,
      );
      setState(prev => ({ ...prev, hasSeenReleaseNotes: true }));
    }
  };

  useEffect(() => {
    checkUpdates();
  }, [checkUpdates]);

  return (
    <UpdateContext.Provider
      value={{
        ...state,
        markReleaseNotesSeen,
        checkUpdates,
        isLoading,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
};

export const useUpdate = () => {
  const context = useContext(UpdateContext);
  if (context === undefined) {
    throw new Error('useUpdate must be used within an UpdateProvider');
  }
  return context;
};
