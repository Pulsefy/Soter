import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
} from 'react-native';
import { useUpdate } from '../contexts/UpdateContext';
import { useTheme } from '../theme/ThemeContext';
import { useTranslation } from '../i18n/useTranslation';
import { formatGraceCountdown } from '../services/updateService';

export interface ForceUpgradeBannerProps {
  /** Optional callback when user taps dismiss */
  onDismiss?: () => void;
  /** Optional override for update action (used for testing or custom navigation) */
  onUpdate?: () => void;
}

/**
 * Global warning banner displayed while a required force-upgrade is in its grace period.
 *
 * Shows the remaining countdown before the app is hard-blocked, explains why the
 * update is required, and gives the user quick access to the store update without
 * interrupting ongoing field tasks.
 */
export const ForceUpgradeBanner: React.FC<ForceUpgradeBannerProps> = ({
  onDismiss,
  onUpdate,
}) => {
  const { upgradeState, remainingGraceMs, versionInfo } = useUpdate();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [isDismissed, setIsDismissed] = useState(false);

  if (upgradeState !== 'warn' || isDismissed) {
    return null;
  }

  const handleUpdate = () => {
    if (onUpdate) {
      onUpdate();
      return;
    }
    if (!versionInfo) return;
    const url =
      Platform.OS === 'ios'
        ? versionInfo.storeUrl.ios
        : versionInfo.storeUrl.android;
    Linking.openURL(url);
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  const countdownText = formatGraceCountdown(remainingGraceMs);
  const title = t('forceUpgrade.warningTitle');
  const message = t('forceUpgrade.warningMessage');

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.warningBg,
          borderColor: colors.warningBorder,
        },
      ]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${title}: ${countdownText} remaining`}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.icon}>⏳</Text>
          <Text
            style={[styles.title, { color: colors.textPrimary }]}
            maxFontSizeMultiplier={2}
          >
            {title}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: colors.warning }]}>
          <Text style={styles.badgeText} maxFontSizeMultiplier={2}>
            {countdownText}
          </Text>
        </View>
      </View>

      <Text
        style={[styles.message, { color: colors.textSecondary }]}
        maxFontSizeMultiplier={2}
      >
        {message}
      </Text>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.warning }]}
          onPress={handleUpdate}
          accessibilityRole="button"
          accessibilityLabel={t('forceUpgrade.updateNow')}
          accessibilityHint="Opens the store to install the required app update"
        >
          <Text style={styles.primaryButtonText} maxFontSizeMultiplier={2}>
            {t('forceUpgrade.updateNow')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.dismissButton, { borderColor: colors.border }]}
          onPress={handleDismiss}
          accessibilityRole="button"
          accessibilityLabel={t('forceUpgrade.dismiss')}
          accessibilityHint="Dismisses the warning banner for the current session"
        >
          <Text
            style={[styles.dismissButtonText, { color: colors.textSecondary }]}
            maxFontSizeMultiplier={2}
          >
            {t('forceUpgrade.dismiss')}
          </Text>
        </TouchableOpacity>
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
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  icon: {
    fontSize: 18,
    marginRight: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  dismissButton: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  dismissButtonText: {
    fontWeight: '600',
    fontSize: 13,
  },
});
