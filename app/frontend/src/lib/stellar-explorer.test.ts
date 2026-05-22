import { describe, expect, it, jest } from '@jest/globals';
import { getStellarExpertTransactionUrl } from './stellar-explorer';

jest.mock('./env', () => ({
  stellarNetwork: 'testnet',
}));

describe('getStellarExpertTransactionUrl', () => {
  it('returns a Stellar Expert testnet transaction URL', () => {
    expect(getStellarExpertTransactionUrl(' abc123 ')).toBe(
      'https://stellar.expert/explorer/testnet/tx/abc123',
    );
  });

  it('returns null when no transaction hash is available', () => {
    expect(getStellarExpertTransactionUrl()).toBeNull();
    expect(getStellarExpertTransactionUrl('   ')).toBeNull();
  });
});
