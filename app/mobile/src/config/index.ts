import { Platform } from 'react-native';

/**
 * Environment variable schema for the Soter mobile app.
 * All variables must be prefixed with EXPO_PUBLIC_ to be accessible in the JS bundle.
 */
export interface AppConfig {
  /** Base URL for the NestJS backend API */
  apiUrl: string;
  /** Environment name (dev, staging, prod) */
  envName: string;
  /** Stellar network (testnet, mainnet) */
  network: 'testnet' | 'mainnet';
  /** WalletConnect V2 Project ID */
  walletConnectProjectId: string;
  /** Expo Project ID for push notifications */
  expoProjectId?: string;
  /** Optional CAIP-2 override for Stellar */
  walletConnectStellarChainId?: string;
  /** Soroban contract ID for the AidEscrow contract */
  sorobanContractId?: string;
  /** Whether the configuration is valid */
  isValid: boolean;
  /** Validation errors if any */
  errors: string[];
}

/**
 * Default fallback API URL based on platform.
 * Android emulator uses 10.0.2.2 to refer to the host machine.
 */
const DEFAULT_LOCAL_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

/**
 * Validate and build the application configuration.
 */
const buildConfig = (): AppConfig => {
  const errors: string[] = [];

  const apiUrl = process.env.EXPO_PUBLIC_API_URL || DEFAULT_LOCAL_API_URL;
  const envName = process.env.EXPO_PUBLIC_ENV_NAME || (apiUrl.includes('prod') ? 'prod' : apiUrl.includes('staging') ? 'staging' : 'dev');
  
  const networkValue = process.env.EXPO_PUBLIC_NETWORK || 'testnet';
  const network: 'testnet' | 'mainnet' = networkValue === 'mainnet' || networkValue === 'public' ? 'mainnet' : 'testnet';

  const walletConnectProjectId = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID || '';
  if (!walletConnectProjectId) {
    errors.push('WalletConnect Project ID is missing (EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID)');
  }

  const sorobanContractId = process.env.EXPO_PUBLIC_SOROBAN_CONTRACT_ID;
  if (!sorobanContractId) {
    // We only warn about this as it might not be needed for all features yet
    console.warn('Soroban Contract ID is missing (EXPO_PUBLIC_SOROBAN_CONTRACT_ID)');
  }

  // Basic URL validation
  try {
    new URL(apiUrl);
  } catch {
    errors.push(`Invalid API URL: ${apiUrl}`);
  }

  return {
    apiUrl,
    envName,
    network,
    walletConnectProjectId,
    expoProjectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    walletConnectStellarChainId: process.env.EXPO_PUBLIC_WALLETCONNECT_STELLAR_CHAIN_ID,
    sorobanContractId,
    isValid: errors.length === 0,
    errors,
  };
};

export const config = buildConfig();

/**
 * Helper to get the WalletConnect chain ID (CAIP-2 format)
 */
export const getStellarChainId = () => {
  if (config.walletConnectStellarChainId) {
    return config.walletConnectStellarChainId;
  }
  return config.network === 'mainnet' ? 'stellar:mainnet' : 'stellar:testnet';
};
