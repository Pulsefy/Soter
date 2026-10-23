import {
  formatWalletSwapWarning,
  shouldWarnAboutWalletSwap,
} from '../services/walletReconnectWarning';

describe('wallet reconnect warnings', () => {
  it('warns and shows both previously used and newly connected wallet addresses when they differ', () => {
    const oldAddress = 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE';
    const newAddress = 'GXYZ9876543210QRSTUVWXYZ1234567890ABCDEF1234567890';

    expect(shouldWarnAboutWalletSwap(oldAddress, newAddress)).toBe(true);
    expect(formatWalletSwapWarning(oldAddress, newAddress)).toContain('different wallet');
    expect(formatWalletSwapWarning(oldAddress, newAddress)).toContain('ABCD...');
    expect(formatWalletSwapWarning(oldAddress, newAddress)).toContain('XYZ9...');
  });

  it('does not warn when reconnecting the same wallet address', () => {
    const address = 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE';
    expect(shouldWarnAboutWalletSwap(address, address)).toBe(false);
  });
});
