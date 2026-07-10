import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useNetworkGuard } from '../hooks/useNetworkGuard';

interface NetworkGuardBannerProps {
  onDismiss?: () => void;
  onSwitchNetwork?: () => void;
}

export const NetworkGuardBanner: React.FC<NetworkGuardBannerProps> = ({
  onDismiss,
  onSwitchNetwork,
}) => {
  const { isMismatch, errorMessage, remediationMessage, walletNetworkInfo } = useNetworkGuard();

  if (!isMismatch) {
    return null;
  }

  const isMainnetIssue = errorMessage?.includes('Mainnet') ?? false;
  const bannerColor = isMainnetIssue ? '#FF6B6B' : '#FFA94D';

  return (
    <View style={[styles.container, { backgroundColor: bannerColor }]}>
      <View style={styles.content}>
        <Text style={styles.title}>
          {isMainnetIssue ? '⚠️ Mainnet Detected' : '⚠️ Network Issue'}
        </Text>
        <Text style={styles.message}>{errorMessage}</Text>
        {remediationMessage && (
          <Text style={styles.remediation}>{remediationMessage}</Text>
        )}
        <View style={styles.buttonContainer}>
          {onSwitchNetwork && (
            <TouchableOpacity style={styles.primaryButton} onPress={onSwitchNetwork}>
              <Text style={styles.buttonText}>Switch Network</Text>
            </TouchableOpacity>
          )}
          {onDismiss && (
            <TouchableOpacity style={styles.secondaryButton} onPress={onDismiss}>
              <Text style={styles.secondaryButtonText}>Dismiss</Text>
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
    color: '#FFFFFF',
    marginBottom: 4,
  },
  message: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.95,
    marginBottom: 2,
  },
  remediation: {
    fontSize: 13,
    color: '#FFFFFF',
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
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
  },
  buttonText: {
    color: '#FF6B6B',
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 14,
  },
  secondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 14,
  },
});