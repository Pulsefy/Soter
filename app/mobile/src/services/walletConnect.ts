// Import polyfills first (required for React Native)
// Use try-catch to handle web environments gracefully
try {
  require('@walletconnect/react-native-compat');
} catch (e) {
  // Polyfills may not be needed or available in all environments
  // This is okay - the app should still work
}

import { SignClient } from '@walletconnect/sign-client';
import { SessionTypes } from '@walletconnect/types';
import * as Linking from 'expo-linking';

// WalletConnect Project ID - Replace with your own from https://cloud.walletconnect.com
// Get your Project ID from: https://cloud.walletconnect.com
const PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID_HERE';

// Stellar namespace configuration for WalletConnect v2
const STELLAR_NAMESPACE = {
  stellar: {
    chains: ['stellar:mainnet'],
    methods: [
      'stellar_signTransaction',
      'stellar_signAndSubmitTransaction',
      'stellar_signMessage',
    ],
    events: ['stellar_accountChanged', 'stellar_chainChanged'],
  },
};

export interface WalletSession {
  topic: string;
  accounts: string[];
  publicKey?: string;
}

class WalletConnectService {
  private signClient: SignClient | null = null;
  private session: WalletSession | null = null;
  private onSessionUpdate?: (session: WalletSession | null) => void;
  private pendingProposal: SessionTypes.Proposal | null = null;

  async initialize() {
    if (this.signClient) {
      return;
    }

    // Don't initialize if Project ID is not set
    if (!PROJECT_ID || PROJECT_ID === 'YOUR_PROJECT_ID_HERE') {
      console.warn('WalletConnect Project ID not set. Wallet connection will not work.');
      return;
    }

    try {
      this.signClient = await SignClient.init({
        projectId: PROJECT_ID,
        metadata: {
          name: 'Soter Mobile',
          description: 'Transparent aid, directly delivered.',
          url: 'https://soter.app',
          icons: ['https://soter.app/icon.png'],
        },
      });

      // Listen for session proposals (for wallet-side proposals)
      this.signClient.on('session_proposal', async (proposal) => {
        console.log('Session proposal received:', proposal);
        this.pendingProposal = proposal.params;
      });

      // Listen for session requests
      this.signClient.on('session_request', async (request) => {
        console.log('Session request received:', request);
      });

      // Listen for session events
      this.signClient.on('session_event', async (event) => {
        console.log('Session event received:', event);
      });

      // Listen for session deletions
      this.signClient.on('session_delete', ({ topic }) => {
        if (this.session?.topic === topic) {
          this.session = null;
          this.onSessionUpdate?.(null);
        }
      });

      // Listen for session updates
      this.signClient.on('session_update', ({ topic, params }) => {
        const session = this.signClient?.session.get(topic);
        if (session) {
          const accounts = session.namespaces?.stellar?.accounts || [];
          const publicKey = accounts[0]?.split(':')[2] || undefined;

          this.session = {
            topic: session.topic,
            accounts,
            publicKey,
          };

          this.onSessionUpdate?.(this.session);
        }
      });

      // Listen for new sessions being established
      this.signClient.on('session_connect', ({ session }) => {
        const accounts = session.namespaces?.stellar?.accounts || [];
        const publicKey = accounts[0]?.split(':')[2] || undefined;

        this.session = {
          topic: session.topic,
          accounts,
          publicKey,
        };

        this.onSessionUpdate?.(this.session);
      });
    } catch (error) {
      console.error('Failed to initialize WalletConnect:', error);
      throw error;
    }
  }

  private pendingApproval: Promise<SessionTypes.Session> | null = null;

  async createConnection(): Promise<string> {
    if (!this.signClient) {
      await this.initialize();
    }

    if (!this.signClient) {
      throw new Error('WalletConnect not initialized. Please set your Project ID in the environment variables or walletConnect.ts');
    }

    try {
      // WalletConnect v2 connect() returns { uri, approval() }
      const { uri, approval } = await this.signClient.connect({
        requiredNamespaces: STELLAR_NAMESPACE,
      });

      if (!uri) {
        throw new Error('Failed to generate connection URI');
      }

      // Set up approval promise to wait for session
      this.pendingApproval = approval().then((session) => {
        const accounts = session.namespaces?.stellar?.accounts || [];
        const publicKey = accounts[0]?.split(':')[2] || undefined;

        this.session = {
          topic: session.topic,
          accounts,
          publicKey,
        };

        this.pendingApproval = null;
        this.onSessionUpdate?.(this.session);
        return session;
      }).catch((error) => {
        console.error('Session approval failed:', error);
        this.pendingApproval = null;
        throw error;
      });

      return uri;
    } catch (error) {
      console.error('Failed to create connection:', error);
      this.pendingApproval = null;
      throw error;
    }
  }

  async waitForSession(): Promise<WalletSession> {
    if (!this.signClient) {
      throw new Error('WalletConnect not initialized');
    }

    // If we have a pending approval, wait for it
    if (this.pendingApproval) {
      try {
        await this.pendingApproval;
        // Session is already set in the approval handler
        if (this.session) {
          return this.session;
        }
      } catch (error) {
        this.pendingApproval = null;
        throw error;
      }
    }

    // Otherwise, wait for session to be established (fallback)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout. Please scan the QR code with your wallet app.'));
      }, 120000); // 120 second timeout

      const checkSession = () => {
        if (this.session) {
          clearTimeout(timeout);
          resolve(this.session);
        } else {
          setTimeout(checkSession, 500);
        }
      };

      // Start checking immediately
      checkSession();
    });
  }

  async disconnect() {
    if (this.session && this.signClient) {
      try {
        await this.signClient.disconnect({
          topic: this.session.topic,
          reason: {
            code: 6000,
            message: 'User disconnected',
          },
        });
      } catch (error) {
        console.error('Failed to disconnect:', error);
      }
    }

    this.session = null;
    this.onSessionUpdate?.(null);
  }

  getSession(): WalletSession | null {
    return this.session;
  }

  getPublicKey(): string | undefined {
    return this.session?.publicKey;
  }

  setOnSessionUpdate(callback: (session: WalletSession | null) => void) {
    this.onSessionUpdate = callback;
  }

  async restoreSessions() {
    if (!this.signClient) {
      await this.initialize();
    }

    if (!this.signClient) {
      return;
    }

    const activeSessions = this.signClient.session.getAll();
    if (activeSessions && activeSessions.length > 0) {
      const session = activeSessions[0];
      const accounts = session.namespaces?.stellar?.accounts || [];
      const publicKey = accounts[0]?.split(':')[2] || undefined;

      this.session = {
        topic: session.topic,
        accounts,
        publicKey,
      };

      this.onSessionUpdate?.(this.session);
    }
  }
}

export const walletConnectService = new WalletConnectService();

