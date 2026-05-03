import React, { createContext, useContext, useState, useEffect } from 'react';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VersionInfo, UpdateState } from '../types/update';
import { fetchVersionInfo, compareVersions } from '../services/updateService';

interface UpdateContextType extends UpdateState {
  markReleaseNotesSeen: () => Promise<void>;
  checkUpdates: () => Promise<void>;
  isLoading: boolean;
}

const UpdateContext = createContext<UpdateContextType | undefined>(undefined);

const SEEN_RELEASE_NOTES_KEY = '@Soter:SeenReleaseNotes';

export const UpdateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<UpdateState>({
    isUpdateAvailable: false,
    isForceUpgrade: false,
    versionInfo: null,
    hasSeenReleaseNotes: true,
  });
  const [isLoading, setIsLoading] = useState(true);

  const currentVersion = Constants.expoConfig?.version || '0.0.0';

  const checkUpdates = async () => {
    try {
      setIsLoading(true);
      const versionInfo = await fetchVersionInfo();
      
      const updateAvailable = compareVersions(versionInfo.latestVersion, currentVersion) > 0;
      const forceUpgrade = compareVersions(versionInfo.minRequiredVersion, currentVersion) > 0;
      
      let hasSeen = true;
      if (updateAvailable) {
        const storedVersion = await AsyncStorage.getItem(SEEN_RELEASE_NOTES_KEY);
        hasSeen = storedVersion === versionInfo.latestVersion;
      }

      setState({
        isUpdateAvailable: updateAvailable,
        isForceUpgrade: forceUpgrade,
        versionInfo,
        hasSeenReleaseNotes: hasSeen,
      });
    } catch (error) {
      console.error('UpdateProvider: Failed to check for updates', error);
    } finally {
      setIsLoading(false);
    }
  };

  const markReleaseNotesSeen = async () => {
    if (state.versionInfo) {
      await AsyncStorage.setItem(SEEN_RELEASE_NOTES_KEY, state.versionInfo.latestVersion);
      setState(prev => ({ ...prev, hasSeenReleaseNotes: true }));
    }
  };

  useEffect(() => {
    checkUpdates();
  }, []);

  return (
    <UpdateContext.Provider 
      value={{ 
        ...state, 
        markReleaseNotesSeen, 
        checkUpdates,
        isLoading 
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
