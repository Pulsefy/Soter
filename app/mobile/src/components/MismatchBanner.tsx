import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNetworkGuard } from '../hooks/useNetworkGuard';
import { useWallet } from '../contexts/WalletContext';

interface Props {
  /** The chain ID the app expects, e.g. "stellar:testnet" */
  expectedChainId: string;
}

/**
 * Displays a prominent warning banner when the connected wallet session is on
 * a network that does not match `expectedChainId`.
 *
 * Renders nothing when there is no mismatch.
 *
 * Accessibility: root container uses role="alert" and liveRegion="assertive"
 * so screen readers announce the banner immediately when it appears.
 */
export const MismatchBanner: React.FC<Props> = ({ expectedChainId }) => {
  const { networkMismatch, sessionChainIds } = useNetworkGuard();
  const { disconnectWallet } = useWallet();

  if (!networkMismatch) {
    return null;
  }

  const detectedLabel = sessionChainIds.join(', ') || 'unknown';

  return (
    <View
      style={styles.banner}
      accessible
      accessibilityRole="alert"
      // @ts-ignore — accessibilityLiveRegion is valid on RN View
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`Wrong network detected. Your wallet is on ${detectedLabel} but this app requires ${expectedChainId}. Disconnect and reconnect on the correct network.`}
    >
      <View style={styles.iconRow}>
        <Text style={styles.icon} accessibilityElementsHidden>
          ⚠️
        </Text>
        <Text style={styles.title} importantForAccessibility="no-hide-descendants">
          Wrong Network Detected
        </Text>
      </View>

      <Text style={styles.body} importantForAccessibility="no-hide-descendants">
        Your wallet is connected to{' '}
        <Text style={styles.chainHighlight}>{detectedLabel}</Text>
        {', but this app requires '}
        <Text style={styles.chainHighlight}>{expectedChainId}</Text>.
      </Text>

      <Text style={styles.hint} importantForAccessibility="no-hide-descendants">
        On-chain actions are disabled until you reconnect on the correct network.
      </Text>

      <TouchableOpacity
        style={styles.button}
        onPress={disconnectWallet}
        accessibilityRole="button"
        accessibilityLabel="Disconnect wallet to fix network mismatch"
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>Disconnect Wallet</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    marginBottom: 4,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  icon: {
    fontSize: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#991B1B',
  },
  body: {
    fontSize: 13,
    color: '#7F1D1D',
    lineHeight: 18,
  },
  chainHighlight: {
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  hint: {
    fontSize: 12,
    color: '#B91C1C',
    lineHeight: 16,
  },
  button: {
    marginTop: 4,
    backgroundColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    minHeight: 40,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
