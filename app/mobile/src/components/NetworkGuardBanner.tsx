import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useNetworkGuard } from '../hooks/useNetworkGuard';
import { useAppTheme } from '../theme/useAppTheme';

interface NetworkGuardBannerProps {
  onDismiss?: () => void;
  onSwitchNetwork?: () => void;
}

export const NetworkGuardBanner: React.FC<NetworkGuardBannerProps> = ({
  onDismiss,
  onSwitchNetwork,
}) => {
  const { isMismatch, errorMessage, remediationMessage, walletNetworkInfo } = useNetworkGuard();
  const { colors } = useAppTheme();

  if (!isMismatch) {
    return null;
  }

  const isMainnetIssue = errorMessage?.includes('Mainnet') ?? false;
  const bannerColor = isMainnetIssue ? colors.error : colors.warning;
  const textColor = colors.background; // Typically, backgrounds have high contrast against surface or pure white
  const buttonColor = colors.card;

  return (
    <View style={[styles.container, { backgroundColor: bannerColor }]} accessible={true} accessibilityRole="alert" accessibilityLabel={`${isMainnetIssue ? 'Mainnet Detected' : 'Network Issue'}: ${errorMessage}`}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: textColor }]} maxFontSizeMultiplier={2}>
          {isMainnetIssue ? '⚠️ Mainnet Detected' : '⚠️ Network Issue'}
        </Text>
        <Text style={[styles.message, { color: textColor }]} maxFontSizeMultiplier={2}>{errorMessage}</Text>
        {remediationMessage && (
          <Text style={[styles.remediation, { color: textColor }]} maxFontSizeMultiplier={2}>{remediationMessage}</Text>
        )}
        <View style={styles.buttonContainer}>
          {onSwitchNetwork && (
            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: buttonColor }]} onPress={onSwitchNetwork} accessibilityRole="button" accessibilityLabel="Switch Network">
              <Text style={[styles.buttonText, { color: bannerColor }]} maxFontSizeMultiplier={2}>Switch Network</Text>
            </TouchableOpacity>
          )}
          {onDismiss && (
            <TouchableOpacity style={styles.secondaryButton} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss alert">
              <Text style={[styles.secondaryButtonText, { color: textColor }]} maxFontSizeMultiplier={2}>Dismiss</Text>
            </TouchableOpacity>
          )}
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
    gap: 12,
    marginTop: 8,
  },
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
  },
  buttonText: {
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 14,
  },
  secondaryButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
  },
  secondaryButtonText: {
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 14,
  },
});