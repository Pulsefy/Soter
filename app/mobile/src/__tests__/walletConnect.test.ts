import {
  buildSep7TransactionUri,
  extractChainIdsFromAccounts,
  extractPublicKeyFromAccounts,
} from '../services/walletConnect';

describe('walletConnect helpers', () => {
  it('extracts the Stellar public key from CAIP-10 accounts', () => {
    const accounts = [
      'stellar:testnet:GABCD1234567890ABCDEFGH1234567890ABCDEFGH1234567890ABCDE',
    ];

    expect(extractPublicKeyFromAccounts(accounts)).toBe(
      'GABCD1234567890ABCDEFGH1234567890ABCDEFGH1234567890ABCDE',
    );
  });

  it('returns unique chain ids from approved accounts', () => {
    const accounts = [
      'stellar:testnet:GAAAA',
      'stellar:testnet:GBBBB',
      'stellar:mainnet:GCCCC',
    ];

    expect(extractChainIdsFromAccounts(accounts)).toEqual([
      'stellar:testnet',
      'stellar:mainnet',
    ]);
  });

  it('builds a SEP-7 transaction request with a url callback', () => {
    const uri = buildSep7TransactionUri({
      xdr: 'AAAA-test-xdr',
      callback: 'https://example.com/callback',
      msg: 'Aid claim signature',
      pubkey: 'GABCD1234567890ABCDEFGH1234567890ABCDEFGH1234567890ABCDE',
    });

    expect(uri).toContain('web+stellar:tx?');
    expect(uri).toContain('xdr=AAAA-test-xdr');
    expect(uri).toContain('callback=url%3Ahttps%3A%2F%2Fexample.com%2Fcallback');
    expect(uri).toContain('msg=Aid+claim+signature');
    expect(uri).toContain('pubkey=GABCD1234567890ABCDEFGH1234567890ABCDEFGH1234567890ABCDE');
  });
});