import React, { useEffect, useRef, useState } from 'react';
import * as ExpoLinking from 'expo-linking';
import {
  NavigationContainer,
  NavigationContainerRef,
} from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@sentry/react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import {
  RootStackParamList,
  deepLinkToNavParams,
} from './src/navigation/types';
import { WalletProvider } from './src/contexts/WalletContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { BiometricProvider } from './src/contexts/BiometricContext';
import { SyncProvider } from './src/contexts/SyncContext';
import {
  NotificationProvider,
  useNotification,
} from './src/contexts/NotificationContext';
import { SaverModeProvider } from './src/contexts/SaverModeContext';
import { SyncDeferralProvider } from './src/contexts/SyncDeferralContext';
import { UpdateProvider, useUpdate } from './src/contexts/UpdateContext';
import {
  CrashReportingProvider,
  useCrashReporting,
} from './src/contexts/CrashReportingContext';
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
  const navigationRef =
    useRef<NavigationContainerRef<RootStackParamList>>(null);
  const { isForceUpgrade, isLoading } = useUpdate();
  const [isNavReady, setIsNavReady] = useState(false);

  // -----------------------------------------------------------------------
  // Navigate when a deep link is pending (from notification tap)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!pendingDeepLink || !isNavReady) return;

    const navParams = deepLinkToNavParams(pendingDeepLink);
    if (!navParams) {
      consumeDeepLink();
      return;
    }

    if (navigationRef.current?.isReady?.()) {
      navigationRef.current.navigate(
        navParams.screen as any,
        navParams.params as any,
      );
      consumeDeepLink();
    }
  }, [pendingDeepLink, isNavReady, consumeDeepLink]);

  if (isLoading) {
    return null;
  }

  if (isForceUpgrade) {
    return <ForceUpgradeScreen />;
  }

  return (
    <WalletProvider>
      <BiometricProvider>
        <SyncDeferralProvider>
          <SyncProvider>
            <NavigationContainer
              linking={linking}
              theme={navTheme}
              ref={navigationRef}
              onReady={() => setIsNavReady(true)}
            >
              <AppNavigator />
              <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            </NavigationContainer>
            <ReleaseNotesModal />
          </SyncProvider>
        </SyncDeferralProvider>
      </BiometricProvider>
    </WalletProvider>
  );
};

// ---------------------------------------------------------------------------
// Root – wraps providers from the outside in
// ---------------------------------------------------------------------------

/**
 * Wrapper that reads the crash-reporting preference and renders the Sentry
 * ErrorBoundary around the rest of the app.
 */
const CrashReportingGate: React.FC = () => {
  const { isLoading } = useCrashReporting();
  // While the preference is loading, render nothing to avoid a flash of the
  // wrong state. The CrashReportingProvider already handles init.
  if (isLoading) return null;

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        // The ErrorBoundary already reports to Sentry automatically.
        // We just log for development diagnostics.
        console.warn('[CrashReportingGate] Caught by ErrorBoundary:', error);
      }}
    >
      <SafeAreaProvider>
        <ThemeProvider>
          <UpdateProvider>
            <SaverModeProvider>
              <SyncDeferralProvider>
                <NotificationProvider>
                  <AppInner />
                </NotificationProvider>
              </SyncDeferralProvider>
            </SaverModeProvider>
          </UpdateProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
};

export default function App() {
  return (
    <CrashReportingProvider>
      <CrashReportingGate />
    </CrashReportingProvider>
  );
}
