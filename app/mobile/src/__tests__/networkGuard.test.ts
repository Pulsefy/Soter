import { 
  detectWalletNetwork,
  validateWalletNetwork,
  validateNetworkConnection,
  checkNetworkGuard,
  shouldBlockAction,
  ensureCorrectNetworkForSigning,
  OnChainNetworkGuard,
  NetworkMismatchError,
  NetworkMismatchErrorCode,
  STELLAR_NETWORKS,
} from '../services/networkGuard';

describe('Network Guard', () => {
  describe('detectWalletNetwork', () => {
    it('should detect Testnet from chain IDs', () => {
      const result = detectWalletNetwork(['stellar:testnet']);
      expect(result).toEqual({
        network: 'TESTNET',
        chainId: 'stellar:testnet',
        isTestnet: true,
        isMainnet: false,
        isKnown: true,
      });
    });

    it('should detect Mainnet from chain IDs', () => {
      const result = detectWalletNetwork(['stellar:public']);
      expect(result).toEqual({
        network: 'MAINNET',
        chainId: 'stellar:public',
        isTestnet: false,
        isMainnet: true,
        isKnown: true,
      });
    });

    it('should handle multiple chain IDs and return first valid Stellar network', () => {
      const result = detectWalletNetwork(['ethereum:1', 'stellar:testnet', 'stellar:public']);
      expect(result).toEqual({
        network: 'TESTNET',
        chainId: 'stellar:testnet',
        isTestnet: true,
        isMainnet: false,
        isKnown: true,
      });
    });

    it('should return unknown for invalid chain IDs', () => {
      const result = detectWalletNetwork(['invalid']);
      expect(result).toEqual({
        network: null,
        chainId: null,
        isTestnet: false,
        isMainnet: false,
        isKnown: false,
      });
    });

    it('should handle null or undefined inputs', () => {
      expect(detectWalletNetwork(null)).toEqual({
        network: null,
        chainId: null,
        isTestnet: false,
        isMainnet: false,
        isKnown: false,
      });
      
      expect(detectWalletNetwork(undefined)).toEqual({
        network: null,
        chainId: null,
        isTestnet: false,
        isMainnet: false,
        isKnown: false,
      });
    });
  });

  describe('validateWalletNetwork', () => {
    it('should not throw for valid Testnet', () => {
      expect(() => validateWalletNetwork(['stellar:testnet'], 'TESTNET')).not.toThrow();
    });

    it('should throw for Mainnet when Testnet is required', () => {
      expect(() => validateWalletNetwork(['stellar:public'], 'TESTNET')).toThrow(NetworkMismatchError);
      
      try {
        validateWalletNetwork(['stellar:public'], 'TESTNET');
      } catch (error) {
        if (error instanceof NetworkMismatchError) {
          expect(error.code).toBe(NetworkMismatchErrorCode.WALLET_ON_MAINNET);
          expect(error.remediation).toContain('switch your wallet to Testnet');
        }
      }
    });

    it('should throw for unknown networks', () => {
      expect(() => validateWalletNetwork(['unknown'], 'TESTNET')).toThrow(NetworkMismatchError);
      
      try {
        validateWalletNetwork(['unknown'], 'TESTNET');
      } catch (error) {
        if (error instanceof NetworkMismatchError) {
          expect(error.code).toBe(NetworkMismatchErrorCode.NETWORK_UNREACHABLE);
        }
      }
    });

    it('should throw when no chain IDs are provided', () => {
      expect(() => validateWalletNetwork(null, 'TESTNET')).toThrow(NetworkMismatchError);
      
      try {
        validateWalletNetwork(null, 'TESTNET');
      } catch (error) {
        if (error instanceof NetworkMismatchError) {
          expect(error.code).toBe(NetworkMismatchErrorCode.NO_NETWORK_CONNECTION);
        }
      }
    });
  });

  describe('validateNetworkConnection', () => {
    it('should not throw when connected', () => {
      const status = { isConnected: true, isInternetReachable: true };
      expect(() => validateNetworkConnection(status)).not.toThrow();
    });

    it('should throw when not connected', () => {
      const status = { isConnected: false, isInternetReachable: null };
      expect(() => validateNetworkConnection(status)).toThrow(NetworkMismatchError);
      
      try {
        validateNetworkConnection(status);
      } catch (error) {
        if (error instanceof NetworkMismatchError) {
          expect(error.code).toBe(NetworkMismatchErrorCode.NO_NETWORK_CONNECTION);
        }
      }
    });

    it('should throw when internet is unreachable', () => {
      const status = { isConnected: true, isInternetReachable: false };
      expect(() => validateNetworkConnection(status)).toThrow(NetworkMismatchError);
      
      try {
        validateNetworkConnection(status);
      } catch (error) {
        if (error instanceof NetworkMismatchError) {
          expect(error.code).toBe(NetworkMismatchErrorCode.NETWORK_UNREACHABLE);
        }
      }
    });
  });

  describe('checkNetworkGuard', () => {
    it('should return no mismatch when everything is correct', () => {
      const result = checkNetworkGuard(
        ['stellar:testnet'],
        { isConnected: true, isInternetReachable: true },
      );
      
      expect(result.isMismatch).toBe(false);
      expect(result.error).toBeNull();
      expect(result.walletNetwork?.isTestnet).toBe(true);
    });

    it('should return mismatch for Mainnet', () => {
      const result = checkNetworkGuard(
        ['stellar:public'],
        { isConnected: true, isInternetReachable: true },
      );
      
      expect(result.isMismatch).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe(NetworkMismatchErrorCode.WALLET_ON_MAINNET);
    });

    it('should return mismatch for no connection', () => {
      const result = checkNetworkGuard(
        ['stellar:testnet'],
        { isConnected: false, isInternetReachable: null },
      );
      
      expect(result.isMismatch).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe(NetworkMismatchErrorCode.NO_NETWORK_CONNECTION);
    });
  });

  describe('shouldBlockAction', () => {
    it('should block when there is a mismatch', () => {
      const result = {
        isMismatch: true,
        error: new NetworkMismatchError(
          NetworkMismatchErrorCode.WALLET_ON_MAINNET,
          'Test error',
          'Test remediation',
        ),
        walletNetwork: null,
        requiredNetwork: 'TESTNET',
      };
      
      expect(shouldBlockAction(result)).toBe(true);
    });

    it('should not block when no mismatch', () => {
      const result = {
        isMismatch: false,
        error: null,
        walletNetwork: null,
        requiredNetwork: 'TESTNET',
      };
      
      expect(shouldBlockAction(result)).toBe(false);
    });
  });

  describe('ensureCorrectNetworkForSigning', () => {
    it('should not throw when on Testnet and connected', () => {
      expect(() => ensureCorrectNetworkForSigning(
        ['stellar:testnet'],
        { isConnected: true, isInternetReachable: true },
      )).not.toThrow();
    });

    it('should throw on Mainnet', () => {
      expect(() => ensureCorrectNetworkForSigning(
        ['stellar:public'],
        { isConnected: true, isInternetReachable: true },
      )).toThrow(NetworkMismatchError);
    });

    it('should throw when not connected', () => {
      expect(() => ensureCorrectNetworkForSigning(
        [],
        { isConnected: true, isInternetReachable: true },
      )).toThrow(NetworkMismatchError);
    });
  });

  describe('OnChainNetworkGuard', () => {
    it('should create guard with default network', () => {
      const guard = new OnChainNetworkGuard();
      expect(guard).toBeDefined();
    });

    it('should create guard with custom network', () => {
      const guard = new OnChainNetworkGuard('MAINNET');
      expect(guard).toBeDefined();
    });

    it('should check network correctly', () => {
      const guard = new OnChainNetworkGuard('TESTNET');
      const result = guard.check(
        ['stellar:testnet'],
        { isConnected: true, isInternetReachable: true },
      );
      
      expect(result.isMismatch).toBe(false);
    });

    it('should ensure correct network for signing', () => {
      const guard = new OnChainNetworkGuard('TESTNET');
      
      expect(() => guard.ensureCorrectNetworkForSigning(
        ['stellar:testnet'],
        { isConnected: true, isInternetReachable: true },
      )).not.toThrow();
    });

    it('should get remediation instructions', () => {
      const guard = new OnChainNetworkGuard('TESTNET');
      const result = guard.check(
        ['stellar:public'],
        { isConnected: true, isInternetReachable: true },
      );
      
      const instructions = guard.getRemediationInstructions(result);
      expect(instructions).toContain('switch');
      expect(instructions).toContain('Testnet');
    });
  });

  describe('Network constants', () => {
    it('should have correct Testnet configuration', () => {
      expect(STELLAR_NETWORKS.TESTNET).toEqual({
        chainId: 'testnet',
        passphrase: 'Test SDF Network ; September 2015',
        explorerUrl: 'https://testnet.stellar.expert',
        horizonUrl: 'https://horizon-testnet.stellar.org',
      });
    });

    it('should have correct Mainnet configuration', () => {
      expect(STELLAR_NETWORKS.MAINNET).toEqual({
        chainId: 'public',
        passphrase: 'Public Global Stellar Network ; September 2015',
        explorerUrl: 'https://stellar.expert',
        horizonUrl: 'https://horizon.stellar.org',
      });
    });
  });
});