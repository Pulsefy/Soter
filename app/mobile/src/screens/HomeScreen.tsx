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
import { useTranslation } from '../i18n/useTranslation';

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
  const { t } = useTranslation();

  const isConnected = status === 'connected';
  const isBusy = status === 'connecting';
  const isAwaitingApproval = status === 'awaiting-approval';

  const walletButtonLabel = (() => {
    if (isConnected) return t('home.disconnectWallet');
    if (isBusy) return t('home.preparingWallet');
    if (isAwaitingApproval) return t('home.waitingApproval');
    return t('home.connectWallet');
  })();

  const walletStatusLabel = (() => {
    switch (status) {
      case 'connected':        return t('home.connected');
      case 'connecting':       return t('home.preparing');
      case 'awaiting-approval': return t('home.approveInWallet');
      case 'error':            return t('home.needsAttention');
      default:                 return t('home.notConnected');
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
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('home.openSettings')}
            accessibilityHint={t('home.openSettingsHint')}
            style={styles.settingsButton}
            onPress={() => navigation.navigate('Settings')}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.settingsIcon} accessibilityElementsHidden>⚙️</Text>
          </TouchableOpacity>

          {/* App title — decorative, not interactive */}
          <Text style={styles.title} accessibilityRole="header">Soter</Text>

          <View
            style={styles.badge}
            accessible
            accessibilityLabel={t('common.poweredByStellar')}
          >
            <Text style={styles.badgeText} importantForAccessibility="no-hide-descendants">
              {t('common.poweredByStellar')}
            </Text>
          </View>
        </View>

        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>
            {t('home.heroTitle')}
          </Text>
          <Text style={styles.description}>
            {t('home.heroDescription')}
          </Text>
        </View>

        {/* ── Wallet Card ────────────────────────────────────────────────── */}
        <View style={styles.walletCard}>
          <View style={styles.walletHeaderRow}>
            <Text style={styles.walletTitle}>{t('home.mobileWallet')}</Text>
            {/* Status badge — announced as a live region so VoiceOver/TalkBack
                reads it when the wallet status changes */}
            <View
              style={[
                styles.walletStatusBadge,
                isConnected
                  ? styles.walletStatusConnected
                  : isAwaitingApproval || isBusy
                    ? styles.walletStatusPending
                    : styles.walletStatusIdle,
              ]}
              accessible
              accessibilityLabel={t('home.walletStatusLabel', { status: walletStatusLabel })}
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.walletStatusText} importantForAccessibility="no-hide-descendants">
                {walletStatusLabel}
              </Text>
            </View>
          </View>

          <Text style={styles.walletDescription}>
            {t('home.walletDescription')}
          </Text>

          {publicKey ? (
            <View
              style={styles.walletKeyCard}
              accessible
              accessibilityLabel={t('home.connectedKeyLabel', {
                publicKey,
                walletName: walletName ?? t('home.walletConnectDefault'),
              })}
            >
              <Text style={styles.walletKeyLabel} importantForAccessibility="no-hide-descendants">
                {t('home.connectedPublicKey')}
              </Text>
              <Text
                style={styles.walletKeyValue}
                selectable
                importantForAccessibility="no-hide-descendants"
              >
                {publicKey}
              </Text>
              <Text style={styles.walletHint} importantForAccessibility="no-hide-descendants">
                {t('home.activeWallet', {
                  walletName: walletName || t('home.walletConnectDefault'),
                })}
              </Text>
            </View>
          ) : (
            <Text style={styles.walletHint}>
              {t('home.walletHint')}
            </Text>
          )}

          {error ? (
            <Text
              style={styles.walletError}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
            >
              {error}
            </Text>
          ) : null}

          {!publicKey && pairingUri ? (
            <Text style={styles.walletMeta} numberOfLines={1}>
              {t('home.pairingUriReady', { uri: pairingUri })}
            </Text>
          ) : null}

          {lastDeepLinkUrl ? (
            <Text style={styles.walletMeta} numberOfLines={1}>
              {t('home.lastWalletLink', { url: lastDeepLinkUrl })}
            </Text>
          ) : null}

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={walletButtonLabel}
            accessibilityHint={
              isConnected
                ? t('home.disconnectHint')
                : t('home.connectHint')
            }
            accessibilityState={{ disabled: isBusy, busy: isBusy }}
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
              <Text style={styles.walletButtonSubtext} accessibilityElementsHidden>
                {formattedPublicKey}
              </Text>
            ) : null}
          </TouchableOpacity>

          {isAwaitingApproval && pairingUri ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('home.reopenWallet')}
              accessibilityHint={t('home.reopenWalletHint')}
              style={styles.walletSecondaryButton}
              onPress={reopenWallet}
              activeOpacity={0.7}
            >
              <Text style={styles.walletSecondaryButtonText}>
                {t('home.reopenWallet')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Action Buttons ─────────────────────────────────────────────── */}
        <View style={styles.actionContainer}>
          <TouchableOpacity
            style={styles.primaryButton}
            accessibilityRole="button"
            accessibilityLabel={t('home.checkBackendHealth')}
            accessibilityHint={t('home.healthHint')}
            onPress={() => navigation.navigate('Health')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>{t('home.checkBackendHealth')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            accessibilityRole="button"
            accessibilityLabel={t('home.operatorTaskList')}
            accessibilityHint={t('home.taskListHint')}
            onPress={() => navigation.navigate('TaskList')}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryButtonText}>
              {t('home.operatorTaskList')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            accessibilityRole="button"
            accessibilityLabel={t('home.submissionQueue')}
            accessibilityHint={t('home.queueHint')}
            onPress={() => navigation.navigate('SubmissionQueue')}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryButtonText}>
              {t('home.submissionQueue')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            accessibilityRole="button"
            accessibilityLabel={t('home.viewAidDetails')}
            accessibilityHint={t('home.aidDetailsHint')}
            onPress={() => navigation.navigate('AidDetails', { aidId: '1' })}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryButtonText}>
              {t('home.viewAidDetails')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.info }]}
            accessibilityRole="button"
            accessibilityLabel={t('home.ngoBulkScanMode')}
            accessibilityHint={t('home.bulkScanHint')}
            onPress={() => navigation.navigate('BulkScanner')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>{t('home.ngoBulkScanMode')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── QR Scanner FAB ─────────────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.scannerFab}
        onPress={() => navigation.navigate('Scanner')}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('home.scanQrCode')}
        accessibilityHint={t('home.scanQrHint')}
      >
        <Text style={styles.scannerFabIcon} accessibilityElementsHidden>📷</Text>
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
      // Minimum 44×44 pt tap target (WCAG 2.5.5)
      minWidth: 44,
      minHeight: 44,
      padding: 8,
      justifyContent: 'center',
      alignItems: 'center',
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
      // Minimum 44 pt height for tap-target compliance (badge is not tappable
      // but we keep vertical padding generous for readability at large text)
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
      // Minimum 44 pt height (WCAG 2.5.5)
      paddingVertical: 16,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
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
      // Minimum 44 pt height
      paddingVertical: 14,
      minHeight: 44,
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
      // Minimum 44 pt height
      paddingVertical: 16,
      minHeight: 44,
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
      // Minimum 44 pt height
      paddingVertical: 16,
      minHeight: 44,
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
      // 64×64 — well above the 44 pt minimum
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
