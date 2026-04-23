import React, { useMemo } from 'react';
import {
  View,
  Text,
  Switch,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';
import { useBiometric } from '../contexts/BiometricContext';

export const SettingsScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { biometricEnabled, biometricSupported, toggleBiometric } = useBiometric();

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text
          style={styles.sectionHeader}
          accessibilityRole="header"
        >
          Security
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
            <Text style={styles.rowTitle}>Biometric Lock</Text>
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
      </View>
    </SafeAreaView>
  );
};

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
      padding: 24,
    },
    sectionHeader: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 8,
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
  });
