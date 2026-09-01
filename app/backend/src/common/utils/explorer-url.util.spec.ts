import {
  explorerBase,
  explorerTxUrl,
  explorerContractUrl,
} from './explorer-url.util';

describe('explorer-url.util', () => {
  describe('explorerBase', () => {
    it('returns mainnet URL for mainnet', () => {
      expect(explorerBase('mainnet')).toBe(
        'https://stellar.expert/explorer/public',
      );
    });

    it('returns testnet URL for testnet', () => {
      expect(explorerBase('testnet')).toBe(
        'https://stellar.expert/explorer/testnet',
      );
    });

    it('returns futurenet URL for futurenet', () => {
      expect(explorerBase('futurenet')).toBe(
        'https://stellar.expert/explorer/futurenet',
      );
    });

    it('defaults to testnet for unknown network', () => {
      expect(explorerBase('unknown')).toBe(
        'https://stellar.expert/explorer/testnet',
      );
    });

    it('is case-insensitive', () => {
      expect(explorerBase('Mainnet')).toBe(
        'https://stellar.expert/explorer/public',
      );
      expect(explorerBase('TESTNET')).toBe(
        'https://stellar.expert/explorer/testnet',
      );
    });
  });

  describe('explorerTxUrl', () => {
    it('builds a testnet tx URL', () => {
      expect(explorerTxUrl('ABCD1234', 'testnet')).toBe(
        'https://stellar.expert/explorer/testnet/tx/ABCD1234',
      );
    });

    it('builds a mainnet tx URL', () => {
      expect(explorerTxUrl('ABCD1234', 'mainnet')).toBe(
        'https://stellar.expert/explorer/public/tx/ABCD1234',
      );
    });

    it('defaults to testnet for unknown network', () => {
      expect(explorerTxUrl('ABCD1234', 'staging')).toBe(
        'https://stellar.expert/explorer/testnet/tx/ABCD1234',
      );
    });
  });

  describe('explorerContractUrl', () => {
    it('builds a testnet contract URL', () => {
      expect(explorerContractUrl('CABC123', 'testnet')).toBe(
        'https://stellar.expert/explorer/testnet/contract/CABC123',
      );
    });

    it('builds a mainnet contract URL', () => {
      expect(explorerContractUrl('CABC123', 'mainnet')).toBe(
        'https://stellar.expert/explorer/public/contract/CABC123',
      );
    });

    it('defaults to testnet for unknown network', () => {
      expect(explorerContractUrl('CABC123', 'unknown')).toBe(
        'https://stellar.expert/explorer/testnet/contract/CABC123',
      );
    });
  });
});
