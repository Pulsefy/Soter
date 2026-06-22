import { act } from 'react';
import { useWalletStore } from '@/lib/walletStore';
import { signTransaction, NetworkMismatchError } from '@/lib/stellarUtils';

jest.mock('@/lib/env', () => ({
  EXPECTED_NETWORK: 'testnet',
  stellarNetwork: 'testnet',
}));

jest.mock('@stellar/freighter-api', () => ({
  signTransaction: jest.fn().mockResolvedValue({ signedTxXdr: 'signed-xdr' }),
}));

function setWalletNetwork(network: string | null) {
  act(() => {
    useWalletStore.setState({ publicKey: network ? 'GABC' : null, network });
  });
}

afterEach(() => {
  setWalletNetwork(null);
  jest.clearAllMocks();
});

describe('signTransaction network guard', () => {
  it('throws NetworkMismatchError when wallet network is null', async () => {
    setWalletNetwork(null);
    await expect(signTransaction('xdr')).rejects.toThrow(NetworkMismatchError);
  });

  it('throws NetworkMismatchError when wallet is on wrong network', async () => {
    setWalletNetwork('mainnet');
    await expect(signTransaction('xdr')).rejects.toThrow(NetworkMismatchError);
  });

  it('includes remediation message in the error', async () => {
    setWalletNetwork('mainnet');
    await expect(signTransaction('xdr')).rejects.toThrow(/Switch networks in Freighter/);
  });

  it('proceeds to sign when wallet is on the correct network', async () => {
    setWalletNetwork('testnet');
    const result = await signTransaction('xdr');
    expect(result).toBe('signed-xdr');
  });

  it('proceeds when network comparison is case-insensitive', async () => {
    setWalletNetwork('TESTNET');
    const result = await signTransaction('xdr');
    expect(result).toBe('signed-xdr');
  });
});
