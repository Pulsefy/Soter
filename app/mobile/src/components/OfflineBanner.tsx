import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  visible: boolean;
  cachedAt?: string | null;
}

/**
 * Displays a banner when the device is offline.
 * Optionally shows when the data was last cached.
 */
export const OfflineBanner: React.FC<Props> = ({ visible, cachedAt }) => {
  if (!visible) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.icon}>📡</Text>
      <View>
        <Text style={styles.title}>Offline</Text>
        {cachedAt && (
          <Text style={styles.subtitle}>Showing cached data from {cachedAt}</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderBottomWidth: 1,
    borderBottomColor: '#F59E0B',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  icon: {
    fontSize: 18,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400E',
  },
  subtitle: {
    fontSize: 12,
    color: '#B45309',
    marginTop: 2,
  },
});
