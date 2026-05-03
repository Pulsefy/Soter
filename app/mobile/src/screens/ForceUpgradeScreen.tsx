import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
  SafeAreaView,
  Image,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useUpdate } from '../contexts/UpdateContext';

export const ForceUpgradeScreen: React.FC = () => {
  const { colors } = useTheme();
  const { versionInfo } = useUpdate();

  const handleUpdate = () => {
    if (!versionInfo) return;
    const url = Platform.OS === 'ios' ? versionInfo.storeUrl.ios : versionInfo.storeUrl.android;
    Linking.openURL(url);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: colors.errorBg }]}>
          <Text style={{ fontSize: 40 }}>🚀</Text>
        </View>

        <Text style={[styles.title, { color: colors.textPrimary }]}>
          Update Required
        </Text>
        
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          A critical update is available for Soter. To continue using the app safely and access the latest security fixes, please update to the latest version.
        </Text>

        <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>
            Current Version Incompatible
          </Text>
          <Text style={[styles.infoText, { color: colors.textMuted }]}>
            Required: {versionInfo?.minRequiredVersion || 'Newer version'}
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.brand.primary }]}
          onPress={handleUpdate}
        >
          <Text style={styles.buttonText}>Update Now</Text>
        </TouchableOpacity>
        
        <Text style={[styles.footerText, { color: colors.textMuted }]}>
          You will be redirected to the {Platform.OS === 'ios' ? 'App Store' : 'Google Play Store'}
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 32,
  },
  infoBox: {
    width: '100%',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 12,
  },
  footer: {
    padding: 32,
  },
  button: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  footerText: {
    fontSize: 12,
    textAlign: 'center',
  },
});
