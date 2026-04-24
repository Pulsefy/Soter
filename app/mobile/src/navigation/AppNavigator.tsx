import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { HomeScreen } from '../screens/HomeScreen';
import { HealthScreen } from '../screens/HealthScreen';
import { AidOverviewScreen } from '../screens/AidOverviewScreen';
import { AidDetailsScreen } from '../screens/AidDetailsScreen';
import { ClaimReceiptScreen } from '../screens/ClaimReceiptScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ScannerScreen } from '../screens/ScannerScreen';
import { TaskListScreen } from '../screens/TaskListScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator = () => {
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{
          headerShown: false,
          // Settings gear accessible from Home via header right
          // (HomeScreen has headerShown: false, so we add a floating button there instead)
        }}
      />
      <Stack.Screen
        name="Health"
        component={HealthScreen}
        options={{ title: 'System Health' }}
      />
      <Stack.Screen
        name="AidOverview"
        component={AidOverviewScreen}
        options={{ title: 'Aid Overview' }}
      />
      <Stack.Screen
        name="AidDetails"
        component={AidDetailsScreen}
        options={{ title: 'Aid Details' }}
      />
      <Stack.Screen
        name="Scanner"
        component={ScannerScreen}
        options={{ title: 'Scan QR Code', presentation: 'modal' }}
      />
      <Stack.Screen
        name="ClaimReceipt"
        component={ClaimReceiptScreen}
        options={{ title: 'Claim Receipt' }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
      <Stack.Screen
        name="TaskList"
        component={TaskListScreen}
        options={{ title: 'My Tasks' }}
      />
    </Stack.Navigator>
  );
};
