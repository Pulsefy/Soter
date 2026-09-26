import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useWallet } from '../contexts/WalletContext';
import { useAppTheme } from '../theme/useAppTheme';

interface WalletSessionBannerProps {
  /**
   * Override the default "Try Again" label.
   */
  recoverLabel?: string;
  /**
   * Called after the internal recoverSession() fires, so the parent can do
   * additional work (e.g. navigate away or refresh).
   */
  onRecover?: () => void;
}

/**
 * Displays a non-intrusive banner while the wallet session is being restored
 * on mount, or when the restore fails.
 *
 * - While restoring: shows a subtle "Restoring wallet session…" indicator.
 * - On failure:      shows an error message + "Try Again" CTA that calls
 *                    recoverSession() so the user can connect manually.
 * - On success or idle: renders nothing.
 */
export const WalletSessionBanner: React.FC<WalletSessionBannerProps> = ({
  recoverLabel = 'Try Again',
  onRecover,
}) => {
  const { restoreStatus, error, recoverSession, connectWallet } = useWallet();
  const { colors } = useAppTheme();

  if (restoreStatus === 'restoring') {
    return (
      <View
        style={[styles.container, styles.restoringContainer, { backgroundColor: colors.card }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Restoring wallet session"
      >
        <ActivityIndicator
          size="small"
          color={colors.primary}
          accessibilityElementsHidden
        />
        <Text
          style={[styles.restoringText, { color: colors.text }]}
          maxFontSizeMultiplier={2}
        >
          Restoring wallet session…
        </Text>
      </View>
    );
  }

  if (restoreStatus === 'failed') {
    const handleRecover = () => {
      recoverSession();
      onRecover?.();
    };

    return (
      <View
        style={[styles.container, { backgroundColor: colors.error }]}
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`Wallet session restore failed: ${error ?? 'Unknown error'}. ${recoverLabel} to connect manually.`}
      >
        <View style={styles.content}>
          <Text
            style={[styles.title, { color: colors.background }]}
            maxFontSizeMultiplier={2}
          >
            ⚠️ Session Could Not Be Restored
          </Text>
          {error ? (
            <Text
              style={[styles.message, { color: colors.background }]}
              maxFontSizeMultiplier={2}
            >
              {error}
            </Text>
          ) : null}
          <Text
            style={[styles.hint, { color: colors.background }]}
            maxFontSizeMultiplier={2}
          >
            Your previous wallet session is no longer valid. Tap below to
            connect your wallet again.
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.recoverButton, { backgroundColor: colors.card }]}
              onPress={handleRecover}
              accessibilityRole="button"
              accessibilityLabel={recoverLabel}
              accessibilityHint="Clears the error and lets you connect your wallet again"
            >
              <Text
                style={[styles.recoverButtonText, { color: colors.error }]}
                maxFontSizeMultiplier={2}
              >
                {recoverLabel}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.connectButton, { backgroundColor: colors.primary }]}
              onPress={async () => {
                recoverSession();
                onRecover?.();
                await connectWallet();
              }}
              accessibilityRole="button"
              accessibilityLabel="Connect Wallet"
              accessibilityHint="Opens WalletConnect to pair a new Stellar wallet"
            >
              <Text
                style={[styles.connectButtonText, { color: colors.background }]}
                maxFontSizeMultiplier={2}
              >
                Connect Wallet
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // 'restored' or 'none' — nothing to show
  return null;
};

const styles = StyleSheet.create({
  container: {
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
  restoringContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  restoringText: {
    fontSize: 14,
    opacity: 0.75,
  },
  content: {
    padding: 16,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  message: {
    fontSize: 14,
    opacity: 0.9,
    marginBottom: 2,
  },
  hint: {
    fontSize: 13,
    opacity: 0.85,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  recoverButton: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  recoverButtonText: {
    fontWeight: '600',
    fontSize: 14,
  },
  connectButton: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  connectButtonText: {
    fontWeight: '600',
    fontSize: 14,
  },
});
