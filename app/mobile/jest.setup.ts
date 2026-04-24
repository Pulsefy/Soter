jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-barcode-scanner relies on native modules not available in Jest.
jest.mock('expo-barcode-scanner', () => {
  const React = require('react');
  const { View } = require('react-native');

  const BarCodeScanner = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, null, children);

  BarCodeScanner.requestPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });

  return { BarCodeScanner };
});
