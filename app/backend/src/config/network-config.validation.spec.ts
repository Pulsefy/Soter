import { validateNetworkConfig } from './network-config.validation';

describe('validateNetworkConfig', () => {
  it('passes through a valid testnet configuration unchanged', () => {
    const env = {
      SOROBAN_NETWORK: 'testnet',
      STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
      STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    };

    expect(validateNetworkConfig(env)).toBe(env);
  });

  it('passes when network vars are entirely unset (defaults to testnet)', () => {
    const env = {};

    expect(() => validateNetworkConfig(env)).not.toThrow();
  });

  it('passes a valid mainnet configuration', () => {
    const env = {
      SOROBAN_NETWORK: 'mainnet',
      STELLAR_RPC_URL: 'https://mainnet.sorobanrpc.com',
      STELLAR_NETWORK_PASSPHRASE:
        'Public Global Stellar Network ; September 2015',
    };

    expect(() => validateNetworkConfig(env)).not.toThrow();
  });

  it('rejects an unknown SOROBAN_NETWORK value', () => {
    const env = { SOROBAN_NETWORK: 'devnet' };

    expect(() => validateNetworkConfig(env)).toThrow(/SOROBAN_NETWORK/);
  });

  it('rejects a mainnet passphrase under a testnet network', () => {
    const env = {
      SOROBAN_NETWORK: 'testnet',
      STELLAR_NETWORK_PASSPHRASE:
        'Public Global Stellar Network ; September 2015',
    };

    expect(() => validateNetworkConfig(env)).toThrow(
      /STELLAR_NETWORK_PASSPHRASE/,
    );
  });

  it('rejects a testnet passphrase under a mainnet network', () => {
    const env = {
      SOROBAN_NETWORK: 'mainnet',
      STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    };

    expect(() => validateNetworkConfig(env)).toThrow(
      /STELLAR_NETWORK_PASSPHRASE/,
    );
  });

  it('rejects a mainnet RPC URL under a testnet network', () => {
    const env = {
      SOROBAN_NETWORK: 'testnet',
      STELLAR_RPC_URL: 'https://mainnet.sorobanrpc.com',
    };

    expect(() => validateNetworkConfig(env)).toThrow(/STELLAR_RPC_URL/);
  });

  it('rejects a testnet RPC URL under a mainnet network', () => {
    const env = {
      SOROBAN_NETWORK: 'mainnet',
      STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
    };

    expect(() => validateNetworkConfig(env)).toThrow(/STELLAR_RPC_URL/);
  });
});
