import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';

type HomeScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Home'
>;

interface Props {
  navigation: HomeScreenNavigationProp;
}


export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const {
    connectWallet,
    disconnectWallet,
    error,
    lastDeepLinkUrl,
    pairingUri,
    publicKey,
    reopenWallet,
    status,
    walletName,
  } = useWallet();

  const isConnected = status === 'connected';
  const isBusy = status === 'connecting';
  const isAwaitingApproval = status === 'awaiting-approval';

  const walletButtonLabel = (() => {
    if (isConnected) {
      return 'Disconnect Wallet';
    }

    if (isBusy) {
      return 'Preparing WalletConnect...';
    }

    if (isAwaitingApproval) {
      return 'Waiting for Wallet Approval';
    }

    return 'Connect Wallet';
  })();

  const walletStatusLabel = (() => {
    switch (status) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Preparing';
      case 'awaiting-approval':
        return 'Approve in Wallet';
      case 'error':
        return 'Needs Attention';
      default:
        return 'Not Connected';
    }
  })();

  const formattedPublicKey = publicKey
    ? `${publicKey.slice(0, 8)}...${publicKey.slice(-8)}`
    : null;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open Settings"
            style={styles.settingsButton}
            onPress={() => navigation.navigate('Settings')}
            activeOpacity={0.7}
          >
            <Text style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Soter</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Powered by Stellar</Text>
          </View>
        </View>

        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>
            Transparent aid, directly delivered.
          </Text>
          <Text style={styles.description}>
            Soter utilizes the Stellar network and Soroban smart contracts to
            ensure aid reaches those in need with 100% transparency. Our
            automated escrow system guarantees that every donation is tracked
            and verified on-chain.
          </Text>
        </View>

        <View style={styles.walletCard}>
          <View style={styles.walletHeaderRow}>
            <Text style={styles.walletTitle}>Mobile Wallet</Text>
            <View
              style={[
                styles.walletStatusBadge,
                isConnected
                  ? styles.walletStatusConnected
                  : isAwaitingApproval || isBusy
                    ? styles.walletStatusPending
                    : styles.walletStatusIdle,
              ]}
            >
              <Text style={styles.walletStatusText}>{walletStatusLabel}</Text>
            </View>
          </View>

          <Text style={styles.walletDescription}>
            Connect a compatible Stellar wallet with WalletConnect v2. Soter
            also listens for deep links so the app can support wallet handoff
            and transaction signing flows on mobile.
          </Text>

          {publicKey ? (
            <View style={styles.walletKeyCard}>
              <Text style={styles.walletKeyLabel}>Connected Public Key</Text>
              <Text style={styles.walletKeyValue} selectable>
                {publicKey}
              </Text>
              <Text style={styles.walletHint}>
                Active wallet: {walletName || 'WalletConnect session'}
              </Text>
            </View>
          ) : (
            <Text style={styles.walletHint}>
              Use Lobstr, Beans, Freighter, or any compatible wallet that can
              accept WalletConnect links on your device.
            </Text>
          )}

          {error ? <Text style={styles.walletError}>{error}</Text> : null}

          {!publicKey && pairingUri ? (
            <Text style={styles.walletMeta} numberOfLines={1}>
              Pairing URI ready: {pairingUri}
            </Text>
          ) : null}

          {lastDeepLinkUrl ? (
            <Text style={styles.walletMeta} numberOfLines={1}>
              Last wallet link: {lastDeepLinkUrl}
            </Text>
          ) : null}

          <TouchableOpacity
            accessibilityRole="button"
            style={[
              styles.walletButton,
              isConnected
                ? styles.walletDisconnectButton
                : styles.walletConnectButton,
              isBusy && styles.walletButtonDisabled,
            ]}
            onPress={isConnected ? disconnectWallet : connectWallet}
            activeOpacity={0.8}
            disabled={isBusy}
          >
            <Text style={styles.walletButtonText}>{walletButtonLabel}</Text>
            {formattedPublicKey ? (
              <Text style={styles.walletButtonSubtext}>
                {formattedPublicKey}
              </Text>
            ) : null}
          </TouchableOpacity>

          {isAwaitingApproval && pairingUri ? (
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.walletSecondaryButton}
              onPress={reopenWallet}
              activeOpacity={0.7}
            >
              <Text style={styles.walletSecondaryButtonText}>
                Reopen Wallet App
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.actionContainer}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('Health')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Check Backend Health</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() =>
              Alert.alert('Coming Soon', 'Coming in a future wave')
            }
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryButtonText}>
              View Aid Overview (Coming Soon)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('AidDetails', { aidId: '1' })}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryButtonText}>
              View Aid Details
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* QR Scanner FAB */}
      <TouchableOpacity
        style={styles.scannerFab}
        onPress={() => navigation.navigate('Scanner')}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Scan QR Code"
      >
        <Text style={styles.scannerFabIcon}>📷</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContainer: {
      flexGrow: 1,
      padding: 24,
      justifyContent: 'center',
    },
    header: {
      alignItems: 'center',
      marginBottom: 40,
    },
    settingsButton: {
      position: 'absolute',
      top: 0,
      right: 0,
      padding: 8,
    },
    settingsIcon: {
      fontSize: 22,
    },
    title: {
      fontSize: 48,
      fontWeight: '900',
      color: colors.textPrimary,
      letterSpacing: -1,
    },
    badge: {
      backgroundColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 16,
      marginTop: 8,
    },
    badgeText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
    },
    heroSection: {
      marginBottom: 48,
    },
    heroTitle: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 16,
      lineHeight: 34,
    },
    description: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 24,
      paddingHorizontal: 8,
    },
    actionContainer: {
      gap: 16,
      width: '100%',
      maxWidth: 400,
      alignSelf: 'center',
    },
    walletCard: {
      backgroundColor: '#FFFFFF',
      borderRadius: 20,
      padding: 20,
      marginBottom: 32,
      borderWidth: 1,
      borderColor: '#DBEAFE',
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.08,
      shadowRadius: 18,
      elevation: 4,
    },
    walletHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
      marginBottom: 12,
    },
    walletTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: '#0F172A',
    },
    walletStatusBadge: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    walletStatusIdle: {
      backgroundColor: '#E2E8F0',
    },
    walletStatusPending: {
      backgroundColor: '#DBEAFE',
    },
    walletStatusConnected: {
      backgroundColor: '#DCFCE7',
    },
    walletStatusText: {
      color: '#0F172A',
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    walletDescription: {
      fontSize: 15,
      color: '#475569',
      lineHeight: 22,
      marginBottom: 14,
    },
    walletKeyCard: {
      backgroundColor: '#EFF6FF',
      borderRadius: 14,
      padding: 14,
      marginBottom: 14,
    },
    walletKeyLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: '#1D4ED8',
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    walletKeyValue: {
      fontSize: 14,
      fontWeight: '600',
      color: '#0F172A',
    },
    walletHint: {
      fontSize: 14,
      color: '#475569',
      lineHeight: 20,
      marginBottom: 14,
    },
    walletError: {
      fontSize: 14,
      color: '#B91C1C',
      marginBottom: 12,
      lineHeight: 20,
    },
    walletMeta: {
      fontSize: 12,
      color: '#64748B',
      marginBottom: 10,
    },
    walletButton: {
      borderRadius: 14,
      paddingVertical: 16,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    walletConnectButton: {
      backgroundColor: '#0F766E',
    },
    walletDisconnectButton: {
      backgroundColor: '#1E293B',
    },
    walletButtonDisabled: {
      opacity: 0.7,
    },
    walletButtonText: {
      fontSize: 17,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    walletButtonSubtext: {
      marginTop: 6,
      fontSize: 12,
      fontWeight: '600',
      color: '#CCFBF1',
    },
    walletSecondaryButton: {
      marginTop: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: '#BFDBFE',
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor: '#F8FAFC',
    },
    walletSecondaryButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: '#1D4ED8',
    },
    primaryButton: {
      backgroundColor: colors.brand.primary,
      paddingVertical: 16,
      borderRadius: 12,
      alignItems: 'center',
      shadowColor: colors.brand.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 4,
    },
    primaryButtonText: {
      color: '#FFFFFF',
      fontSize: 18,
      fontWeight: '700',
    },
    secondaryButton: {
      backgroundColor: colors.surface,
      paddingVertical: 16,
      borderRadius: 12,
      alignItems: 'center',
      borderWidth: 2,
      borderColor: colors.border,
    },
    secondaryButtonText: {
      color: colors.textSecondary,
      fontSize: 16,
      fontWeight: '600',
    },
    scannerFab: {
      position: 'absolute',
      right: 24,
      bottom: 24,
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.brand.primary,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: colors.brand.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
      elevation: 8,
    },
    scannerFabIcon: {
      fontSize: 28,
    },
  });
