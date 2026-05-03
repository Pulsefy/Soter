import React, { useEffect, useRef } from 'react';
import * as ExpoLinking from 'expo-linking';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { RootStackParamList, deepLinkToNavParams } from './src/navigation/types';
import { WalletProvider } from './src/contexts/WalletContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { BiometricProvider } from './src/contexts/BiometricContext';
import { SyncProvider } from './src/contexts/SyncContext';
import {
  NotificationProvider,
  useNotification,
} from './src/contexts/NotificationContext';
import { SaverModeProvider } from './src/contexts/SaverModeContext';
import { UpdateProvider, useUpdate } from './src/contexts/UpdateContext';
import { ReleaseNotesModal } from './src/components/ReleaseNotesModal';
import { ForceUpgradeScreen } from './src/screens/ForceUpgradeScreen';

// ---------------------------------------------------------------------------
// Deep-link configuration for React Navigation
// ---------------------------------------------------------------------------

const linking = {
  prefixes: [ExpoLinking.createURL('/'), 'soter://'],

  config: {
    screens: {
      Home: '',
      AidOverview: 'aid',
      AidDetails: 'aid/:aidId',
      ClaimReceipt: 'claim/:claimId',
      Settings: 'settings',
      Health: 'health',
      Scanner: 'scanner',
    },
  },
};

// ---------------------------------------------------------------------------
// Inner component – lives inside all providers so it can access contexts
// ---------------------------------------------------------------------------

const AppInner = () => {
  const { navTheme, scheme } = useTheme();
  const { pendingDeepLink, consumeDeepLink } = useNotification();
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const { isForceUpgrade, isLoading } = useUpdate();

  // -----------------------------------------------------------------------
  // Navigate when a deep link is pending (from notification tap)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!pendingDeepLink) return;

    const navParams = deepLinkToNavParams(pendingDeepLink);
    if (!navParams) {
      consumeDeepLink();
      return;
    }

    const timer = setTimeout(() => {
      if (navigationRef.current) {
        navigationRef.current.navigate(
          navParams.screen as any,
          navParams.params as any,
        );
      }
      consumeDeepLink();
    }, 300);

    return () => clearTimeout(timer);
  }, [pendingDeepLink, consumeDeepLink]);

  if (isLoading) {
    return null;
  }

  if (isForceUpgrade) {
    return <ForceUpgradeScreen />;
  }

  return (
    <WalletProvider>
      <BiometricProvider>
        <SyncProvider>
          <NavigationContainer
            linking={linking}
            theme={navTheme}
            ref={navigationRef}
          >
            <AppNavigator />
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          </NavigationContainer>
          <ReleaseNotesModal />
        </SyncProvider>
      </BiometricProvider>
    </WalletProvider>
  );
};

// ---------------------------------------------------------------------------
// Root – wraps providers from the outside in
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <UpdateProvider>
          <SaverModeProvider>
            <NotificationProvider>
              <AppInner />
            </NotificationProvider>
          </SaverModeProvider>
        </UpdateProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
