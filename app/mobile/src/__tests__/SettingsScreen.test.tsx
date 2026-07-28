import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SettingsScreen } from '../screens/SettingsScreen';
import { config } from '../config';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => {
    const { Colors, SoterLightTheme } = require('../theme/theme');

    return {
      colors: { ...Colors.light, brand: Colors.brand },
      navTheme: SoterLightTheme,
      scheme: 'light',
    };
  },
}));

jest.mock('../contexts/BiometricContext', () => ({
  useBiometric: () => ({
    biometricEnabled: false,
    biometricSupported: true,
    toggleBiometric: jest.fn(),
  }),
}));

jest.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    permissionGranted: false,
    requestPermission: jest.fn().mockResolvedValue(true),
  }),
}));

jest.mock('../contexts/SaverModeContext', () => ({
  useSaverMode: () => ({
    active: false,
    source: 'manual',
    autoDetectEnabled: true,
    toggleManual: jest.fn(),
    toggleAutoDetect: jest.fn(),
  }),
}));

describe('SettingsScreen', () => {
  beforeEach(() => {
    (config as { network: 'testnet' | 'mainnet' }).network = 'testnet';
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows official faucet links on testnet', () => {
    const { getByText } = render(<SettingsScreen />);

    expect(getByText('Get Testnet XLM')).toBeTruthy();
    expect(getByText('Stellar Lab faucet')).toBeTruthy();
    expect(getByText('Friendbot API')).toBeTruthy();
  });

  it('opens the Stellar Lab faucet', () => {
    const { getByText } = render(<SettingsScreen />);

    fireEvent.press(getByText('Stellar Lab faucet'));

    expect(Linking.openURL).toHaveBeenCalledWith('https://lab.stellar.org/account/fund');
  });

  it('hides faucet links outside testnet', () => {
    (config as { network: 'testnet' | 'mainnet' }).network = 'mainnet';

    const { queryByText } = render(<SettingsScreen />);

    expect(queryByText('Get Testnet XLM')).toBeNull();
    expect(queryByText('Stellar Lab faucet')).toBeNull();
  });
});
