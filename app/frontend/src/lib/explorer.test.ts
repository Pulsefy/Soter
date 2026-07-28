import { buildExplorerUrl } from './explorer';

jest.mock('./env', () => ({
  stellarNetwork: 'testnet',
}));

describe('explorer link builder utility', () => {
  describe('buildExplorerUrl', () => {
    it('uses the mocked default network (testnet) when no network is specified', () => {
      const url = buildExplorerUrl('tx', 'abc');
      expect(url).toBe('https://stellar.expert/explorer/testnet/tx/abc');
    });

    it('handles explicit networks correctly', () => {
      expect(buildExplorerUrl('tx', 'abc', 'testnet')).toBe(
        'https://stellar.expert/explorer/testnet/tx/abc'
      );
      expect(buildExplorerUrl('contract', 'def', 'mainnet')).toBe(
        'https://stellar.expert/explorer/public/contract/def'
      );
      expect(buildExplorerUrl('address', 'ghi', 'public')).toBe(
        'https://stellar.expert/explorer/public/address/ghi'
      );
      expect(buildExplorerUrl('tx', 'jkl', 'futurenet')).toBe(
        'https://stellar.expert/explorer/futurenet/tx/jkl'
      );
    });

    it('falls back to testnet for standalone or unknown networks', () => {
      expect(buildExplorerUrl('tx', 'abc', 'standalone')).toBe(
        'https://stellar.expert/explorer/testnet/tx/abc'
      );
      expect(buildExplorerUrl('contract', 'def', 'local')).toBe(
        'https://stellar.expert/explorer/testnet/contract/def'
      );
      expect(buildExplorerUrl('address', 'ghi', '')).toBe(
        'https://stellar.expert/explorer/testnet/address/ghi'
      );
    });

    it('formats URLs correctly for all link types', () => {
      expect(buildExplorerUrl('tx', 'tx-hash', 'testnet')).toBe(
        'https://stellar.expert/explorer/testnet/tx/tx-hash'
      );
      expect(buildExplorerUrl('contract', 'contract-id', 'testnet')).toBe(
        'https://stellar.expert/explorer/testnet/contract/contract-id'
      );
      expect(buildExplorerUrl('address', 'address-id', 'testnet')).toBe(
        'https://stellar.expert/explorer/testnet/address/address-id'
      );
    });

    it('handles mixed case and whitespace in network names', () => {
      expect(buildExplorerUrl('tx', 'abc', '  TESTNET  ')).toBe(
        'https://stellar.expert/explorer/testnet/tx/abc'
      );
      expect(buildExplorerUrl('tx', 'abc', 'MainNet')).toBe(
        'https://stellar.expert/explorer/public/tx/abc'
      );
      expect(buildExplorerUrl('tx', 'abc', 'FUTURENET')).toBe(
        'https://stellar.expert/explorer/futurenet/tx/abc'
      );
    });
  });
});
