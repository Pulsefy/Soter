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
import {
  resolveVersionInfo,
  compareVersions,
  resolveGraceDeadline,
  determineUpgradeState,
  clearStoredGraceDeadline,
  UpgradeEvaluation,
} from '../services/updateService';
import { config } from '../config';
import { structuredLogger } from '../services/logger';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

interface UpdateContextType extends UpdateState {
  markReleaseNotesSeen: () => Promise<void>;
  checkUpdates: () => Promise<void>;
  isLoading: boolean;
  isGracePeriodActive: boolean;
}

const UpdateContext = createContext<UpdateContextType | undefined>(undefined);

const SEEN_RELEASE_NOTES_KEY = '@Soter:SeenReleaseNotes';

interface UpdateProviderProps {
  children: React.ReactNode;
  defaultGracePeriodMs?: number;
}

export const UpdateProvider: React.FC<UpdateProviderProps> = ({
  children,
  defaultGracePeriodMs,
}) => {
  const [state, setState] = useState<UpdateState>({
    isUpdateAvailable: false,
    isForceUpgrade: false,
    upgradeState: 'none',
    versionInfo: null,
    hasSeenReleaseNotes: true,
    graceDeadline: null,
    remainingGraceMs: 0,
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
          upgradeState: 'none',
          graceDeadline: null,
          remainingGraceMs: 0,
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
      const requiresUpgrade =
        compareVersions(versionInfo.minRequiredVersion, currentVersion) > 0;

      let upgradeEvaluation: UpgradeEvaluation;
      if (requiresUpgrade) {
        const configuredGrace =
          defaultGracePeriodMs !== undefined
            ? defaultGracePeriodMs
            : config.forceUpgradeGracePeriodMs;
        const deadline = await resolveGraceDeadline(
          versionInfo,
          configuredGrace,
        );
        upgradeEvaluation = determineUpgradeState(
          currentVersion,
          versionInfo.minRequiredVersion,
          deadline,
        );
      } else {
        await clearStoredGraceDeadline();
        upgradeEvaluation = {
          upgradeState: 'none',
          graceDeadline: null,
          remainingGraceMs: 0,
          isForceUpgrade: false,
        };
      }

      let hasSeen = true;
      if (updateAvailable) {
        const storedVersion = await AsyncStorage.getItem(
          SEEN_RELEASE_NOTES_KEY,
        );
        hasSeen = storedVersion === versionInfo.latestVersion;
      }

      setState({
        isUpdateAvailable: updateAvailable,
        isForceUpgrade: upgradeEvaluation.isForceUpgrade,
        upgradeState: upgradeEvaluation.upgradeState,
        graceDeadline: upgradeEvaluation.graceDeadline,
        remainingGraceMs: upgradeEvaluation.remainingGraceMs,
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
  }, [currentVersion, defaultGracePeriodMs]);

  // Active countdown timer when in 'warn' state
  useEffect(() => {
    if (state.upgradeState !== 'warn' || !state.graceDeadline) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, state.graceDeadline! - now);
      if (remaining <= 0) {
        clearInterval(interval);
        structuredLogger.info(
          'updates.grace_period_expired',
          { minRequiredVersion: state.versionInfo?.minRequiredVersion },
          'updates',
        );
        setState(prev => ({
          ...prev,
          upgradeState: 'block',
          isForceUpgrade: true,
          remainingGraceMs: 0,
        }));
      } else {
        setState(prev => ({
          ...prev,
          remainingGraceMs: remaining,
        }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [
    state.upgradeState,
    state.graceDeadline,
    state.versionInfo?.minRequiredVersion,
  ]);

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
        isGracePeriodActive: state.upgradeState === 'warn',
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

