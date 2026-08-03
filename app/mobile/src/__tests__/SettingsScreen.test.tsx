import React from 'react';
import { Clipboard, Linking } from 'react-native';
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
    jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});
    // Reset wallet mock to disconnected state
    mockWalletState = {
      disconnectWallet: jest.fn(),
      publicKey: null,
      isOnCorrectNetwork: false,
      status: 'idle',
    };
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

  describe('when wallet is connected on testnet', () => {
    const TEST_PUBKEY =
      'GABCD1234567890ABCDEFGH1234567890ABCDEFGH1234567890ABCDE';

    beforeEach(() => {
      mockWalletState = {
        disconnectWallet: jest.fn(),
        publicKey: TEST_PUBKEY,
        isOnCorrectNetwork: true,
        status: 'connected',
      };
    });

    it('displays the public key and copy/explorer actions', () => {
      const { getByText } = render(<SettingsScreen />);

      expect(getByText('Your Public Key')).toBeTruthy();
      expect(getByText(TEST_PUBKEY)).toBeTruthy();
      expect(getByText('Copy Key')).toBeTruthy();
      expect(getByText('View in Explorer')).toBeTruthy();
    });

    it('copies the public key to clipboard when Copy Key is pressed', () => {
      const { getByText } = render(<SettingsScreen />);

      fireEvent.press(getByText('Copy Key'));

      expect(Clipboard.setString).toHaveBeenCalledWith(TEST_PUBKEY);
    });

    it('opens the account explorer when View in Explorer is pressed', () => {
      const { getByText } = render(<SettingsScreen />);

      fireEvent.press(getByText('View in Explorer'));

      expect(Linking.openURL).toHaveBeenCalledWith(
        `https://stellar.expert/explorer/testnet/account/${TEST_PUBKEY}`,
      );
    });

    it('shows balance refresh hint after funding', () => {
      const { getByText } = render(<SettingsScreen />);

      expect(
        getByText(/use the explorer to verify your balance/i),
      ).toBeTruthy();
    });
  });

  describe('when wallet is not connected on testnet', () => {
    it('shows a hint to connect wallet first', () => {
      const { getByText, queryByText } = render(<SettingsScreen />);

      expect(getByText(/connect your wallet first/i)).toBeTruthy();
      expect(queryByText('Your Public Key')).toBeNull();
      expect(queryByText('Copy Key')).toBeNull();
    });
  });
});
