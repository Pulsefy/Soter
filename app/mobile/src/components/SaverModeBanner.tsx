import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SaverModeSource } from '../contexts/SaverModeContext';

interface Props {
  visible: boolean;
  source: SaverModeSource;
}

/**
 * Banner shown at the top of screens when Saver Mode is active.
 * Explains *why* certain features are reduced so the user understands
 * the degraded behaviour.
 */
export const SaverModeBanner: React.FC<Props> = ({ visible, source }) => {
  if (!visible) return null;

  const reason =
    source === 'auto'
      ? 'Slow or metered connection detected'
      : 'Manually enabled';

  return (
    <View
      style={styles.banner}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`Saver mode is active. ${reason}. Refresh, media, and background sync are reduced.`}
    >
      <Text style={styles.icon} accessibilityElementsHidden>
        &#x1F4A1;
      </Text>
      <View style={styles.textContainer}>
        <Text style={styles.title}>Saver Mode</Text>
        <Text style={styles.subtitle}>
          {reason}. Refresh, media &amp; background sync reduced.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DBEAFE',
    borderBottomWidth: 1,
    borderBottomColor: '#60A5FA',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  icon: {
    fontSize: 16,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E3A5F',
  },
  subtitle: {
    fontSize: 12,
    color: '#2D5F8A',
    marginTop: 2,
  },
});
