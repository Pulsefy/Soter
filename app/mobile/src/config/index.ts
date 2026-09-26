import { Platform } from 'react-native';
import { structuredLogger } from '../services/logger';

/**
 * Environment variable schema for the Soter mobile app.
 * All variables must be prefixed with EXPO_PUBLIC_ to be accessible in the JS bundle.
 */
import type { LogLevel } from '../services/logger';

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
  /** Battery threshold (0-1) below which sync is deferred */
  batteryThreshold?: number;
  /** Size threshold in bytes for large uploads that defer on metered connections */
  largeUploadThreshold?: number;
  /** Whether to allow sync on metered connections without user opt-in */
  allowMeteredSync?: boolean;
  /** Maximum serialized AsyncStorage bytes for cached aid packages */
  aidCacheMaxBytes: number;
  /** Maximum serialized AsyncStorage bytes for cached tasks */
  taskCacheMaxBytes: number;
  /** Ratio of cache usage at which the app warns operators */
  localCacheWarningRatio: number;
  /** Base64-encoded SHA-256 SPKI pins for the API host (primary + backups) used for certificate pinning */
  certPinHashes: string[];
  /** Whether to pin all subdomains of the API host, not just the exact hostname */
  certPinIncludeSubdomains: boolean;
  /** Lowest log level that should be persisted for support diagnostics */
  logLevel: LogLevel;
  /** API key for backend authentication */
  apiKey?: string;
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
    structuredLogger.warn(
      'config.missing_contract_id',
      { key: 'EXPO_PUBLIC_SOROBAN_CONTRACT_ID' },
      'config',
    );
  }

  // Basic URL validation
  try {
    new URL(apiUrl);
  } catch {
    errors.push(`Invalid API URL: ${apiUrl}`);
  }

  const certPinHashes = (process.env.EXPO_PUBLIC_CERT_PIN_HASHES || '')
    .split(',')
    .map((hash: string) => hash.trim())
    .filter(Boolean);

  return {
    apiUrl,
    envName,
    network,
    walletConnectProjectId,
    expoProjectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    walletConnectStellarChainId: process.env.EXPO_PUBLIC_WALLETCONNECT_STELLAR_CHAIN_ID,
    sorobanContractId,
    batteryThreshold: process.env.EXPO_PUBLIC_BATTERY_THRESHOLD 
      ? parseFloat(process.env.EXPO_PUBLIC_BATTERY_THRESHOLD) 
      : 0.2, // Default: defer below 20% battery
    largeUploadThreshold: process.env.EXPO_PUBLIC_LARGE_UPLOAD_THRESHOLD 
      ? parseInt(process.env.EXPO_PUBLIC_LARGE_UPLOAD_THRESHOLD, 10) 
      : 5 * 1024 * 1024, // Default: 5MB
    allowMeteredSync: process.env.EXPO_PUBLIC_ALLOW_METERED_SYNC === 'true',
    aidCacheMaxBytes: process.env.EXPO_PUBLIC_AID_CACHE_MAX_BYTES
      ? parseInt(process.env.EXPO_PUBLIC_AID_CACHE_MAX_BYTES, 10)
      : 512 * 1024,
    taskCacheMaxBytes: process.env.EXPO_PUBLIC_TASK_CACHE_MAX_BYTES
      ? parseInt(process.env.EXPO_PUBLIC_TASK_CACHE_MAX_BYTES, 10)
      : 256 * 1024,
    localCacheWarningRatio: process.env.EXPO_PUBLIC_LOCAL_CACHE_WARNING_RATIO
      ? parseFloat(process.env.EXPO_PUBLIC_LOCAL_CACHE_WARNING_RATIO)
      : 0.8,
    certPinHashes,
    certPinIncludeSubdomains: process.env.EXPO_PUBLIC_CERT_PIN_INCLUDE_SUBDOMAINS === 'true',
    logLevel: (process.env.EXPO_PUBLIC_LOG_LEVEL as LogLevel) || 'warn',
    apiKey: process.env.EXPO_PUBLIC_API_KEY,
    isValid: errors.length === 0,
    errors,
  };
};

export const config = buildConfig();
structuredLogger.setLevel(config.logLevel);

/**
 * Helper to get the WalletConnect chain ID (CAIP-2 format)
 */
export const getStellarChainId = () => {
  if (config.walletConnectStellarChainId) {
    return config.walletConnectStellarChainId;
  }
  return config.network === 'mainnet' ? 'stellar:mainnet' : 'stellar:testnet';
};
