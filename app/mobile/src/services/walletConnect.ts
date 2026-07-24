import * as ExpoLinking from 'expo-linking';
import SignClient from '@walletconnect/sign-client';

import { config, getStellarChainId } from '../config';
import { detectWalletNetwork } from './networkGuard';

const APP_SCHEME = 'soter';
const DEFAULT_APP_URL = 'https://github.com/Pulsefy/Soter';
const DEFAULT_ICON = 'https://raw.githubusercontent.com/Pulsefy/Soter/main/app/mobile/assets/icon.png';
const STELLAR_NAMESPACE = 'stellar';

const STELLAR_METHODS = ['stellar_signXDR', 'stellar_signAndSubmitXDR'];
const STELLAR_EVENTS = ['accountsChanged', 'chainChanged'];

export type WalletConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'awaiting-approval'
  | 'connected'
  | 'error';

export interface ConnectedWalletSession {
  topic: string;
  publicKey: string;
  accounts: string[];
  walletName: string | null;
  chainIds: string[];
}

export interface Sep7TransactionRequest {
  xdr: string;
  callback?: string;
  chain?: string;
  msg?: string;
  networkPassphrase?: string;
  originDomain?: string;
  pubkey?: string;
}

type SessionShape = {
  namespaces?: Record<string, { accounts?: string[] }>;
  peer?: {
    metadata?: {
      name?: string;
    };
  };
  topic: string;
};

let signClientPromise: Promise<SignClient> | null = null;

const getWalletConnectProjectId = () => {
  return config.walletConnectProjectId;
};

export const getWalletConnectChainId = () => {
  return getStellarChainId();
};

const getAppMetadata = () => ({
  name: 'Soter Mobile',
  description: 'Soter mobile wallet connection for transparent aid delivery on Stellar.',
  url: DEFAULT_APP_URL,
  icons: [DEFAULT_ICON],
  redirect: {
    native: `${APP_SCHEME}://wallet`,
  },
});

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected wallet error occurred.';
};

const getSessionAccounts = (session: SessionShape) => {
  return Object.values(session.namespaces ?? {}).flatMap(
    (namespace) => namespace.accounts ?? [],
  );
};

const getSessionExpiry = (session: SessionShape) => {
  const expiry = (session as SessionShape & { expiry?: number | string }).expiry;

  if (typeof expiry === 'number') {
    return expiry;
  }

  if (typeof expiry === 'string') {
    const parsedValue = Number(expiry);
    if (!Number.isNaN(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
};

const ensureValidWalletSessionState = (
  session: SessionShape,
  accounts: string[],
  publicKey: string | null,
  chainIds: string[],
) => {
  if (!accounts.length) {
    throw new Error('The stored WalletConnect session is missing account state. Reconnect to continue.');
  }

  if (!publicKey) {
    throw new Error('The stored WalletConnect session did not expose a Stellar account. Reconnect and approve the Stellar namespace again.');
  }

  if (!chainIds.length) {
    throw new Error('The stored WalletConnect session did not expose usable chain information. Reconnect to continue.');
  }

  const expiry = getSessionExpiry(session);
  if (expiry !== null && expiry <= Math.floor(Date.now() / 1000)) {
    throw new Error('The stored WalletConnect session is expired. Reconnect to continue.');
  }

  const expectedChainId = getWalletConnectChainId();
  const expectedNetwork = expectedChainId.split(':')[1];
  const networkInfo = detectWalletNetwork(chainIds);

  if (!networkInfo.isKnown) {
    throw new Error('The restored wallet session could not be validated. Reconnect and ensure your wallet is on the expected network.');
  }

  if (expectedNetwork === 'testnet' && !networkInfo.isTestnet) {
    throw new Error('The restored wallet session is on the wrong network. Switch your wallet to Testnet and reconnect.');
  }

  if (expectedNetwork === 'public' && !networkInfo.isMainnet) {
    throw new Error('The restored wallet session is on the wrong network. Switch your wallet to Mainnet and reconnect.');
  }
};

export const extractPublicKeyFromAccounts = (accounts: string[]) => {
  const stellarAccount = accounts.find((account) => account.startsWith(`${STELLAR_NAMESPACE}:`));
  if (!stellarAccount) {
    return null;
  }

  const parts = stellarAccount.split(':');
  return parts[2] ?? null;
};

export const extractChainIdsFromAccounts = (accounts: string[]) => {
  return Array.from(
    new Set(
      accounts
        .map((account) => account.split(':'))
        .filter((parts) => parts.length >= 2)
        .map(([namespace, chainId]) => `${namespace}:${chainId}`),
    ),
  );
};

const toConnectedWalletSession = (session: SessionShape): ConnectedWalletSession => {
  const accounts = getSessionAccounts(session);
  const publicKey = extractPublicKeyFromAccounts(accounts);
  const chainIds = extractChainIdsFromAccounts(accounts);

  ensureValidWalletSessionState(session, accounts, publicKey, chainIds);

  return {
    topic: session.topic,
    publicKey: publicKey as string,
    accounts,
    walletName: session.peer?.metadata?.name ?? null,
    chainIds,
  };
};

export const validateRestoredWalletSession = (session: SessionShape): ConnectedWalletSession => {
  return toConnectedWalletSession(session);
};

const getSignClient = async () => {
  const projectId = getWalletConnectProjectId();
  if (!projectId) {
    throw new Error(
      'Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID before attempting to connect a wallet.',
    );
  }

  if (!signClientPromise) {
    signClientPromise = SignClient.init({
      projectId,
      metadata: getAppMetadata(),
    });
  }

  return signClientPromise;
};

export const buildSep7TransactionUri = ({
  xdr,
  callback,
  chain,
  msg,
  networkPassphrase,
  originDomain,
  pubkey,
}: Sep7TransactionRequest) => {
  const params = new URLSearchParams();
  params.set('xdr', xdr);

  if (callback) {
    params.set('callback', callback.startsWith('url:') ? callback : `url:${callback}`);
  }

  if (chain) {
    params.set('chain', chain);
  }

  if (msg) {
    params.set('msg', msg);
  }

  if (networkPassphrase) {
    params.set('network_passphrase', networkPassphrase);
  }

  if (originDomain) {
    params.set('origin_domain', originDomain);
  }

  if (pubkey) {
    params.set('pubkey', pubkey);
  }

  return `web+stellar:tx?${params.toString()}`;
};

export const openSep7TransactionRequest = async (request: Sep7TransactionRequest) => {
  const uri = buildSep7TransactionUri(request);
  await ExpoLinking.openURL(uri);
  return uri;
};

export const openWalletConnectPairingUri = async (pairingUri: string) => {
  const canOpen = await ExpoLinking.canOpenURL(pairingUri);
  if (!canOpen) {
    throw new Error(
      'No compatible wallet is registered to handle WalletConnect links on this device.',
    );
  }

  await ExpoLinking.openURL(pairingUri);
};

export const createWalletConnection = async () => {
  const client = await getSignClient();
  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      [STELLAR_NAMESPACE]: {
        chains: [getWalletConnectChainId()],
        methods: STELLAR_METHODS,
        events: STELLAR_EVENTS,
      },
    },
  });

  if (!uri) {
    throw new Error('WalletConnect did not return a pairing URI for this session.');
  }

  return {
    pairingUri: uri,
    approval: async () => toConnectedWalletSession(await approval()),
  };
};

export const restoreWalletSession = async () => {
  if (!getWalletConnectProjectId()) {
    return null;
  }

  try {
    const client = await getSignClient();
    const sessions = client.session.getAll();
    if (!sessions.length) {
      return null;
    }

    return validateRestoredWalletSession(sessions[0] as SessionShape);
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
};

export const disconnectWalletSession = async (topic: string) => {
  const client = await getSignClient();
  await client.disconnect({
    topic,
    reason: {
      code: 6000,
      message: 'User disconnected.',
    },
  });
};

export const createWalletCallbackUrl = () => {
  return ExpoLinking.createURL('wallet/callback', { scheme: APP_SCHEME });
};