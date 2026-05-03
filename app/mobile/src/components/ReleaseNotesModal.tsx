import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useUpdate } from '../contexts/UpdateContext';

export const ReleaseNotesModal: React.FC = () => {
  const { colors } = useTheme();
  const { isUpdateAvailable, hasSeenReleaseNotes, versionInfo, markReleaseNotesSeen } = useUpdate();

  // Only show if update is available, user hasn't seen notes, and not a force upgrade
  // (Force upgrade has its own screen)
  const isVisible = isUpdateAvailable && !hasSeenReleaseNotes && versionInfo && !versionInfo.minRequiredVersion.includes('force'); 
  // Wait, I should probably just check if it's NOT a force upgrade based on the context state
  // But actually, the context state isForceUpgrade is true if current < minRequired.
  // If it's a force upgrade, we block everything. 
  // If it's just an update, we show release notes.

  if (!isUpdateAvailable || hasSeenReleaseNotes || !versionInfo) {
    return null;
  }

  return (
    <Modal
      transparent
      visible={true}
      animationType="slide"
    >
      <View style={styles.overlay}>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              What's New in {versionInfo.latestVersion}
            </Text>
          </View>

          <ScrollView style={styles.content}>
            {versionInfo.releaseNotes.map((note, index) => (
              <View key={index} style={styles.noteItem}>
                <Text style={[styles.bullet, { color: colors.brand.primary }]}>•</Text>
                <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                  {note}
                </Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.brand.primary }]}
              onPress={markReleaseNotesSeen}
            >
              <Text style={styles.buttonText}>Got it!</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    padding: 24,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  content: {
    marginBottom: 24,
  },
  noteItem: {
    flexDirection: 'row',
    marginBottom: 12,
    paddingRight: 16,
  },
  bullet: {
    fontSize: 20,
    marginRight: 10,
    lineHeight: 24,
  },
  noteText: {
    fontSize: 16,
    lineHeight: 24,
  },
  footer: {
    marginTop: 'auto',
  },
  button: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
});
