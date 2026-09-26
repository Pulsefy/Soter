import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Switch,
  StyleSheet,
  Alert,
  Clipboard,
  Linking,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';
import { useBiometric } from '../contexts/BiometricContext';
import { useNotification } from '../contexts/NotificationContext';
import { useSaverMode } from '../contexts/SaverModeContext';
import { useCrashReporting } from '../contexts/CrashReportingContext';
import { config } from '../config';
import { useWallet } from '../contexts/WalletContext';
import { getAccountExplorerUrl } from '../explorerUtils';
import type { CacheSummary } from '../services/localCache';
import { clearAidCache, getAidCacheSummary } from '../services/aidCache';
import { clearTaskCache, getTaskCacheSummary } from '../services/taskCache';
import { useTranslation } from '../i18n/useTranslation';
import { useLanguage } from '../contexts/LanguageContext';

const STELLAR_LAB_FAUCET_URL = 'https://lab.stellar.org/account/fund';
const STELLAR_FRIENDBOT_URL = 'https://friendbot-testnet.stellar.org';

interface CacheUsageState {
  aid: CacheSummary;
  task: CacheSummary;
  totalSizeBytes: number;
  totalMaxBytes: number;
  isNearLimit: boolean;
  isOverLimit: boolean;
}

const emptyCacheSummary = (maxBytes: number): CacheSummary => ({
  sizeBytes: 0,
  maxBytes,
  itemCount: 0,
  isNearLimit: false,
  isOverLimit: false,
  warningRatio: config.localCacheWarningRatio,
});

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
};

export const SettingsScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const { locale, isOverridden, deviceLocale, setActiveLocale } = useLanguage();
  const { biometricEnabled, biometricSupported, toggleBiometric } = useBiometric();
  const { permissionGranted, requestPermission, tokenRegistered } = useNotification();
  const {
    active: saverModeActive,
    source: saverModeSource,
    autoDetectEnabled,
    toggleManual,
    toggleAutoDetect,
  } = useSaverMode();
  const {
    enabled: crashReportingEnabled,
    toggle: toggleCrashReporting,
  } = useCrashReporting();
  const { publicKey, status: walletStatus } = useWallet();
  const isWalletConnected = walletStatus === 'connected';
  const [copiedKey, setCopiedKey] = useState(false);
  const [cacheUsage, setCacheUsage] = useState<CacheUsageState>({
    aid: emptyCacheSummary(config.aidCacheMaxBytes),
    task: emptyCacheSummary(config.taskCacheMaxBytes),
    totalSizeBytes: 0,
    totalMaxBytes: config.aidCacheMaxBytes + config.taskCacheMaxBytes,
    isNearLimit: false,
    isOverLimit: false,
  });

  const refreshCacheUsage = useCallback(async () => {
    const [aid, task] = await Promise.all([
      getAidCacheSummary(),
      getTaskCacheSummary(),
    ]);
    const totalSizeBytes = aid.sizeBytes + task.sizeBytes;
    const totalMaxBytes = aid.maxBytes + task.maxBytes;

    setCacheUsage({
      aid,
      task,
      totalSizeBytes,
      totalMaxBytes,
      isNearLimit: aid.isNearLimit || task.isNearLimit,
      isOverLimit: aid.isOverLimit || task.isOverLimit,
    });
  }, []);

  useEffect(() => {
    void refreshCacheUsage();
  }, [refreshCacheUsage]);

  const handleNotificationToggle = async (value: boolean) => {
    if (value) {
      const granted = await requestPermission();
      if (!granted) {
        Alert.alert(
          'Permission Denied',
          'Push notifications could not be enabled. Please check your device settings.',
        );
      }
    } else {
      Alert.alert(
        'Disable Notifications',
        'To disable push notifications, please turn them off in your device settings for Soter.',
      );
    }
  };

  const handleToggle = async (value: boolean) => {
    if (value && !biometricSupported) {
      Alert.alert(
        'Not Available',
        'No biometrics are enrolled on this device. Please set up Face ID or fingerprint in your device settings first.',
      );
      return;
    }
    await toggleBiometric(value);
  };

  const openFaucetTool = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        'Unable to Open Link',
        'Please try again or open the faucet from your browser.',
      );
    }
  };

  const copyPublicKey = async () => {
    if (!publicKey) return;
    try {
      Clipboard.setString(publicKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      Alert.alert('Error', 'Failed to copy public key to clipboard.');
    }
  };

  const openAccountExplorer = async () => {
    if (!publicKey) return;
    const url = getAccountExplorerUrl(publicKey);
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        'Unable to Open Link',
        'Could not open the Stellar Expert explorer.',
      );
    }
  };

  const clearLocalCaches = async () => {
    try {
      const [aidResult, taskResult] = await Promise.all([
        clearAidCache(),
        clearTaskCache(),
      ]);
      await refreshCacheUsage();
      const retainedCount = aidResult.items.length + taskResult.items.length;
      Alert.alert(
        'Offline Cache Cleared',
        retainedCount > 0
          ? `${retainedCount} unsynced item${retainedCount === 1 ? '' : 's'} retained for safety.`
          : 'Cached aid and task data was cleared.',
      );
    } catch {
      Alert.alert('Unable to Clear Cache', 'Please try again from Settings.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
      >
        <Text
          style={styles.sectionHeader}
          accessibilityRole="header"
        >
          {t('settings.language')}
        </Text>
        <Text style={styles.sectionHint}>{t('settings.languageHint')}</Text>

        <View style={styles.languageRow}>
          <Pressable
            style={[
              styles.languageChip,
              !isOverridden && styles.languageChipActive,
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: !isOverridden }}
            accessibilityLabel={t('settings.followDevice')}
            onPress={() => void setActiveLocale(deviceLocale)}
          >
            <Text
              style={[
                styles.languageChipText,
                !isOverridden && styles.languageChipTextActive,
              ]}
            >
              {t('settings.followDevice')}
            </Text>
          </Pressable>
          {(['en', 'es', 'fr'] as const).map((code) => {
            const label =
              code === 'en'
                ? t('common.languageNameEn')
                : code === 'es'
                  ? t('common.languageNameEs')
                  : t('common.languageNameFr');
            return (
              <Pressable
                key={code}
                style={[
                  styles.languageChip,
                  locale === code && styles.languageChipActive,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: locale === code }}
                accessibilityLabel={label}
                onPress={() => void setActiveLocale(code)}
              >
                <Text
                  style={[
                    styles.languageChipText,
                    locale === code && styles.languageChipTextActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text
          style={styles.sectionHeader}
          accessibilityRole="header"
        >
          {t('settings.securityTitle')}
        </Text>

        {/* The row is a single accessible group so VoiceOver/TalkBack reads
            the label, value, and hint together rather than announcing the
            Switch and the label text as separate elements. */}
        <View
          style={styles.row}
          accessible
          accessibilityRole="switch"
          accessibilityLabel="Biometric Lock"
          accessibilityHint={
            biometricSupported
              ? 'Require Face ID or fingerprint before viewing sensitive aid details'
              : 'Biometrics are not available or not enrolled on this device'
          }
          accessibilityValue={{ text: biometricEnabled ? 'on' : 'off' }}
          accessibilityState={{ checked: biometricEnabled, disabled: !biometricSupported }}
          // Tapping the row triggers the same toggle as the Switch
          onAccessibilityTap={() => void handleToggle(!biometricEnabled)}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{t('settings.biometricLock')}</Text>
            <Text style={styles.rowSubtitle}>
              Require Face ID / Fingerprint before viewing sensitive aid details
            </Text>
          </View>
          {/* The Switch is hidden from the accessibility tree because the
              parent View already exposes the full switch semantics. */}
          <Switch
            value={biometricEnabled}
            onValueChange={handleToggle}
            trackColor={{ false: colors.border, true: colors.brand.primary }}
            thumbColor="#FFFFFF"
            disabled={!biometricSupported}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          />
        </View>

        {!biometricSupported && (
          <Text
            style={styles.hint}
            accessibilityRole="alert"
          >
            Biometrics are not available or not enrolled on this device.
          </Text>
        )}

        <Text
          style={styles.sectionHeader}
          accessibilityRole="header"
        >
          Notifications
        </Text>

        <View
          style={styles.row}
          accessible
          accessibilityRole="switch"
          accessibilityLabel="Push Notifications"
          accessibilityHint="Receive push notifications for claim and verification updates"
          accessibilityValue={{ text: permissionGranted ? 'on' : 'off' }}
          accessibilityState={{ checked: permissionGranted }}
          onAccessibilityTap={() => void handleNotificationToggle(!permissionGranted)}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{t('settings.pushNotifications')}</Text>
            <Text style={styles.rowSubtitle}>
              Receive updates for claim and verification status changes
            </Text>
            {permissionGranted && (
              <Text style={[styles.rowSubtitle, { color: tokenRegistered ? colors.text.secondary : colors.error }]}>
                {tokenRegistered ? 'Registered with backend' : 'Backend registration failed'}
              </Text>
            )}
          </View>
          <Switch
            value={permissionGranted}
            onValueChange={handleNotificationToggle}
            trackColor={{ false: colors.border, true: colors.brand.primary }}
            thumbColor="#FFFFFF"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          />
        </View>

        <Text
          style={styles.sectionHeader}
          accessibilityRole="header"
        >
          Crash Reporting
        </Text>

        <View
          style={styles.row}
          accessible
          accessibilityRole="switch"
          accessibilityLabel="Crash Reporting"
          accessibilityHint="Help improve the app by sending anonymous crash reports. No personal data or evidence is collected."
          accessibilityValue={{ text: crashReportingEnabled ? 'on' : 'off' }}
          accessibilityState={{ checked: crashReportingEnabled }}
          onAccessibilityTap={() =>
            void toggleCrashReporting(!crashReportingEnabled)
          }
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{t('settings.crashReporting')}</Text>
            <Text style={styles.rowSubtitle}>
              Send anonymous crash reports to help fix issues. No personal data
              or evidence content is collected.
            </Text>
          </View>
          <Switch
            value={crashReportingEnabled}
            onValueChange={(v) => void toggleCrashReporting(v)}
            trackColor={{ false: colors.border, true: colors.brand.primary }}
            thumbColor="#FFFFFF"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          />
        </View>

        {!crashReportingEnabled && (
          <Text style={styles.hint} accessibilityRole="alert">
            Crash reporting is off. Crashes will not be sent to the development
            team.
          </Text>
        )}

        <Text
          style={styles.sectionHeader}
          accessibilityRole="header"
        >
          Data Saver
        </Text>

        {/* Saver Mode manual toggle */}
        <View
          style={styles.row}
          accessible
          accessibilityRole="switch"
          accessibilityLabel="Saver Mode"
          accessibilityHint="Reduce data usage by limiting polling, media previews, and background refresh"
          accessibilityValue={{ text: saverModeActive ? 'on' : 'off' }}
          accessibilityState={{ checked: saverModeActive }}
          onAccessibilityTap={() => void toggleManual(!saverModeActive)}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{t('settings.saverMode')}</Text>
            <Text style={styles.rowSubtitle}>
              Reduce data usage by limiting refresh, media, and background sync
            </Text>
          </View>
          <Switch
            value={saverModeActive}
            onValueChange={(v) => void toggleManual(v)}
            trackColor={{ false: colors.border, true: colors.brand.primary }}
            thumbColor="#FFFFFF"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          />
        </View>

        {saverModeActive && (
          <Text style={styles.hint} accessibilityRole="alert">
            {saverModeSource === 'auto'
              ? 'Auto-enabled: slow or metered connection detected.'
              : 'Manually enabled. Refresh, media previews, and background sync are reduced.'}
          </Text>
        )}

        {/* Auto-detect toggle */}
        <View
          style={styles.row}
          accessible
          accessibilityRole="switch"
          accessibilityLabel="Auto-detect poor connections"
          accessibilityHint="Automatically enable Saver Mode on slow or metered connections"
          accessibilityValue={{ text: autoDetectEnabled ? 'on' : 'off' }}
          accessibilityState={{ checked: autoDetectEnabled }}
          onAccessibilityTap={() => void toggleAutoDetect(!autoDetectEnabled)}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{t('settings.autoDetect')}</Text>
            <Text style={styles.rowSubtitle}>
              Automatically enable Saver Mode on slow or metered connections
            </Text>
          </View>
          <Switch
            value={autoDetectEnabled}
            onValueChange={(v) => void toggleAutoDetect(v)}
            trackColor={{ false: colors.border, true: colors.brand.primary }}
            thumbColor="#FFFFFF"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          />
        </View>

        <Text
          style={styles.sectionHeader}
          accessibilityRole="header"
        >
          Offline Storage
        </Text>

        <View style={styles.cachePanel}>
          {(cacheUsage.isNearLimit || cacheUsage.isOverLimit) && (
            <Text style={styles.cacheWarning} accessibilityRole="alert">
              Offline cache is nearing its storage limit. Clear synced cache
              data to keep room for evidence capture.
            </Text>
          )}

          <View style={styles.cacheMetricRow}>
            <Text style={styles.cacheMetricLabel}>{t('settings.aidCache')}</Text>
            <Text style={styles.cacheMetricValue}>
              {formatBytes(cacheUsage.aid.sizeBytes)} / {formatBytes(cacheUsage.aid.maxBytes)}
            </Text>
          </View>
          <Text style={styles.cacheMetricHint}>
            {cacheUsage.aid.itemCount} package{cacheUsage.aid.itemCount === 1 ? '' : 's'} cached
          </Text>

          <View style={styles.cacheMetricRow}>
            <Text style={styles.cacheMetricLabel}>{t('settings.taskCache')}</Text>
            <Text style={styles.cacheMetricValue}>
              {formatBytes(cacheUsage.task.sizeBytes)} / {formatBytes(cacheUsage.task.maxBytes)}
            </Text>
          </View>
          <Text style={styles.cacheMetricHint}>
            {cacheUsage.task.itemCount} task{cacheUsage.task.itemCount === 1 ? '' : 's'} cached
          </Text>

          <View style={styles.cacheMetricRow}>
            <Text style={styles.cacheMetricLabel}>{t('settings.cacheTotal')}</Text>
            <Text style={styles.cacheMetricValue}>
              {formatBytes(cacheUsage.totalSizeBytes)} / {formatBytes(cacheUsage.totalMaxBytes)}
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.secondaryLinkButton,
              pressed && styles.linkButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Clear synced offline cache"
            accessibilityHint="Removes cached aid and task data while keeping unsynced local changes"
            onPress={() => void clearLocalCaches()}
          >
            <Text style={styles.secondaryLinkButtonText}>{t('settings.clearSyncedCache')}</Text>
          </Pressable>
        </View>

        {config.network === 'testnet' && (
          <>
            <Text
              style={styles.sectionHeader}
              accessibilityRole="header"
            >
              Get Testnet XLM
            </Text>

            <View style={styles.faucetPanel}>
              <Text style={styles.faucetCopy}>
                Fund your testnet wallet with free XLM from the Stellar
                development network. Copy your public key below, then use one of
                the official faucet tools to send test XLM to your account.
              </Text>

              {isWalletConnected && publicKey ? (
                <>
                  {/* Public Key Display & Copy */}
                  <View style={styles.keyCard}>
                    <Text style={styles.keyLabel}>{t('settings.yourPublicKey')}</Text>
                    <Text
                      style={styles.keyValue}
                      selectable
                      numberOfLines={1}
                      ellipsizeMode="middle"
                    >
                      {publicKey}
                    </Text>
                    <View style={styles.keyActions}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.keyActionButton,
                          pressed && styles.linkButtonPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={
                          copiedKey ? 'Public key copied' : 'Copy public key to clipboard'
                        }
                        accessibilityHint="Copies your Stellar public key for pasting into a faucet"
                        onPress={() => void copyPublicKey()}
                      >
                        <Text style={styles.keyActionText}>
                          {copiedKey ? '✓ Copied' : 'Copy Key'}
                        </Text>
                      </Pressable>

                      <Pressable
                        style={({ pressed }) => [
                          styles.keyActionButtonSecondary,
                          pressed && styles.linkButtonPressed,
                        ]}
                        accessibilityRole="link"
                        accessibilityLabel="View account on Stellar Expert explorer"
                        accessibilityHint="Opens your account on the Stellar Expert testnet explorer to view your balance and transactions"
                        onPress={() => void openAccountExplorer()}
                      >
                        <Text style={styles.keyActionTextSecondary}>
                          View in Explorer
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  <Text style={styles.faucetHint}>
                    After funding, use the explorer to verify your balance and
                    return to the app to continue.
                  </Text>
                </>
              ) : (
                <Text style={styles.faucetHint}>
                  Connect your wallet first to see your public key and fund your
                  account.
                </Text>
              )}

              <View style={styles.linkGroup}>
                <Pressable
                  style={({ pressed }) => [
                    styles.linkButton,
                    pressed && styles.linkButtonPressed,
                  ]}
                  accessibilityRole="link"
                  accessibilityLabel="Open Stellar Lab faucet"
                  accessibilityHint="Opens the official Stellar Lab account funding tool"
                  onPress={() => void openFaucetTool(STELLAR_LAB_FAUCET_URL)}
                >
                  <Text style={styles.linkButtonText}>{t('settings.stellarLabFaucet')}</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryLinkButton,
                    pressed && styles.linkButtonPressed,
                  ]}
                  accessibilityRole="link"
                  accessibilityLabel="Open Friendbot API"
                  accessibilityHint="Opens the official Friendbot endpoint for testnet funding"
                  onPress={() => void openFaucetTool(STELLAR_FRIENDBOT_URL)}
                >
                  <Text style={styles.secondaryLinkButtonText}>{t('settings.friendbotApi')}</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollView: {
      flex: 1,
    },
    container: {
      padding: 24,
      paddingBottom: 40,
    },
    sectionHeader: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 8,
      marginTop: 20,
    },
    sectionHint: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 12,
      lineHeight: 18,
    },
    languageRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 4,
    },
    languageChip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    languageChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    languageChipText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    languageChipTextActive: {
      color: '#FFFFFF',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 14,
      // Minimum 44 pt height (WCAG 2.5.5)
      minHeight: 44,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 12,
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 4,
    },
    rowSubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    hint: {
      marginTop: 12,
      fontSize: 13,
      color: colors.textSecondary,
      paddingHorizontal: 4,
    },
    faucetPanel: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 14,
    },
    cachePanel: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    cacheWarning: {
      backgroundColor: colors.warningBg,
      borderRadius: 8,
      color: colors.warning,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
      padding: 10,
    },
    cacheMetricRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    cacheMetricLabel: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    cacheMetricValue: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    cacheMetricHint: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: -6,
    },
    faucetCopy: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    faucetHint: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      fontStyle: 'italic',
    },
    keyCard: {
      backgroundColor: colors.infoBg,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    keyLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.info,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    keyValue: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      fontFamily: 'monospace',
    },
    keyActions: {
      flexDirection: 'row',
      gap: 10,
    },
    keyActionButton: {
      flex: 1,
      minHeight: 40,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brand.primary,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    keyActionButtonSecondary: {
      flex: 1,
      minHeight: 40,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    keyActionText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
    keyActionTextSecondary: {
      color: colors.info,
      fontSize: 14,
      fontWeight: '700',
    },
    linkGroup: {
      gap: 10,
    },
    linkButton: {
      minHeight: 44,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brand.primary,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    secondaryLinkButton: {
      minHeight: 44,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.infoBg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    linkButtonPressed: {
      opacity: 0.78,
    },
    linkButtonText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '700',
    },
    secondaryLinkButtonText: {
      color: colors.info,
      fontSize: 15,
      fontWeight: '700',
    },
  });
