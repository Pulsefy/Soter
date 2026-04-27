export type ErrorCategory = 'wallet' | 'network' | 'server' | 'unknown';

export interface ErrorMetadata {
  title: string;
  description: string;
  icon?: string;
  hints: string[];
  remediation: string;
  canRetry: boolean;
}

export const ERROR_METADATA: Record<ErrorCategory, ErrorMetadata> = {
  wallet: {
    title: 'Wallet Connection required',
    description: 'We couldn\'t communicate with your Stellar wallet. This is required for secure signatures and claiming aid.',
    hints: [
      'Ensure the Freighter browser extension is installed',
      'Check if your wallet is locked or requires a password',
      'Verify you have granted permission to Soter'
    ],
    remediation: 'Try reconnecting your wallet or unlocking the extension.',
    canRetry: true,
  },
  network: {
    title: 'Network connectivity issue',
    description: 'It looks like there\'s a problem with your internet connection or our network request was blocked.',
    hints: [
      'Check your internet connection',
      'Disable aggressive ad-blockers or VPNs temporarily',
      'Check if the Stellar Horizon/Soroban RPC is accessible'
    ],
    remediation: 'Please check your connection and try again.',
    canRetry: true,
  },
  server: {
    title: 'Service temporary unavailable',
    description: 'Our backend services are experiencing a transient outage or scheduled maintenance.',
    hints: [
      'The system might be under heavy load',
      'Scheduled maintenance might be in progress',
      'Check the Soter status page for updates'
    ],
    remediation: 'We\'re working on it. Please try again in a few minutes.',
    canRetry: true,
  },
  unknown: {
    title: 'Unexpected system error',
    description: 'An uncommon error occurred that we haven\'t specifically categorized yet.',
    hints: [
      'Refresh the page to clear temporary state',
      'Check the console for more technical details',
      'Contact support if the issue persists'
    ],
    remediation: 'Try refreshing the page or starting a new session.',
    canRetry: true,
  }
};
