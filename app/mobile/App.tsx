import React from 'react';
import * as ExpoLinking from 'expo-linking';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { WalletProvider } from './src/contexts/WalletContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { BiometricProvider } from './src/contexts/BiometricContext';

const linking = {
  prefixes: [ExpoLinking.createURL('/'), 'soter://'],
};

// Inner component so useTheme() can be called inside the provider tree
const AppInner = () => {
  const { navTheme, scheme } = useTheme();
  return (
    <WalletProvider>
      <BiometricProvider>
        <NavigationContainer linking={linking}>
          <AppNavigator />
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        </NavigationContainer>
      </BiometricProvider>
    </WalletProvider>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
