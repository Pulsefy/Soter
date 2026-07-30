import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useNetworkGuard } from '../hooks/useNetworkGuard';
import { useWallet } from '../contexts/WalletContext';
import { useAppTheme } from '../theme/useAppTheme';
import { NetworkMismatchErrorCode } from '../services/networkGuard';

interface NetworkGuardBannerProps {
  /**
   * Called when the user taps the dismiss button.
   */
  onDismiss?: () => void;
  /**
   * Called when the user taps "Switch Network".
   * Provide this to open wallet settings or a network-switch flow.
   */
  onSwitchNetwork?: () => void;
}

/**
 * Displays a contextual warning banner when the wallet is on the wrong network.
 *
 * - Wrong network (CHAIN_MISMATCH / WALLET_ON_MAINNET): shows a "Reconnect
 *   Wallet" button that calls recoverSession() so the user can re-pair their
 *   wallet on the correct network. Also shows "Switch Network" if provided.
 * - No internet / unreachable: shows network connectivity instructions only.
 * - No mismatch: renders nothing.
 */
export const NetworkGuardBanner: React.FC<NetworkGuardBannerProps> = ({
  onDismiss,
  onSwitchNetwork,
}) => {
  const { isMismatch, errorMessage, remediationMessage, mismatchResult } = useNetworkGuard();
  const { recoverSession, connectWallet } = useWallet();
  const { colors } = useAppTheme();

  if (!isMismatch) {
    return null;
  }

  const errorCode = mismatchResult?.error?.code;

  // Network-mismatch errors are wallet-side issues; a reconnect recovers them
  const isWalletNetworkIssue =
    errorCode === NetworkMismatchErrorCode.WALLET_ON_MAINNET ||
    errorCode === NetworkMismatchErrorCode.CHAIN_MISMATCH;

  const isMainnetIssue = errorCode === NetworkMismatchErrorCode.WALLET_ON_MAINNET;

  const bannerColor = isMainnetIssue ? colors.error : colors.warning;
  const textColor = colors.background;
  const buttonColor = colors.card;

  const handleReconnect = async () => {
    recoverSession();
    await connectWallet();
  };

  const bannerTitle = isMainnetIssue ? '⚠️ Mainnet Detected' : '⚠️ Network Issue';

  return (
    <View
      style={[styles.container, { backgroundColor: bannerColor }]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${bannerTitle}: ${errorMessage}`}
    >
      <View style={styles.content}>
        <Text
          style={[styles.title, { color: textColor }]}
          maxFontSizeMultiplier={2}
        >
          {bannerTitle}
        </Text>

        <Text
          style={[styles.message, { color: textColor }]}
          maxFontSizeMultiplier={2}
        >
          {errorMessage}
        </Text>

        {remediationMessage ? (
          <Text
            style={[styles.remediation, { color: textColor }]}
            maxFontSizeMultiplier={2}
          >
            {remediationMessage}
          </Text>
        ) : null}

        <View style={styles.buttonContainer}>
          {/* Reconnect Wallet — shown only for wallet-side network mismatches */}
          {isWalletNetworkIssue ? (
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: buttonColor }]}
              onPress={handleReconnect}
              accessibilityRole="button"
              accessibilityLabel="Reconnect Wallet"
              accessibilityHint="Disconnects the current session and opens WalletConnect so you can re-pair on the correct network"
            >
              <Text
                style={[styles.buttonText, { color: bannerColor }]}
                maxFontSizeMultiplier={2}
              >
                Reconnect Wallet
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Switch Network — caller-provided deep-link into wallet settings */}
          {onSwitchNetwork ? (
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: buttonColor }]}
              onPress={onSwitchNetwork}
              accessibilityRole="button"
              accessibilityLabel="Switch Network"
              accessibilityHint="Opens your wallet to change the network setting"
            >
              <Text
                style={[styles.buttonText, { color: bannerColor }]}
                maxFontSizeMultiplier={2}
              >
                Switch Network
              </Text>
            </TouchableOpacity>
          ) : null}

          {onDismiss ? (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss alert"
            >
              <Text
                style={[styles.secondaryButtonText, { color: textColor }]}
                maxFontSizeMultiplier={2}
              >
                Dismiss
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  content: {
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  message: {
    fontSize: 14,
    opacity: 0.95,
    marginBottom: 2,
  },
  remediation: {
    fontSize: 13,
    opacity: 0.85,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  buttonContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    flex: 1,
    minWidth: 100,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 14,
  },
  secondaryButton: {
    flex: 1,
    minWidth: 80,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 14,
  },
});
