import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../theme/useAppTheme';

interface Props {
  visible: boolean;
  cachedAt?: string | null;
  pendingCount?: number;
}

/**
 * Displays a banner when the device is offline.
 * Optionally shows when the data was last cached.
 */
export const OfflineBanner: React.FC<Props> = ({
  visible,
  cachedAt,
  pendingCount = 0,
}) => {
  const { colors } = useAppTheme();

  if (!visible) return null;

  return (
    <View 
      style={[styles.banner, { backgroundColor: colors.warningBg, borderBottomColor: colors.warningBorder }]}
      accessible={true}
      accessibilityRole="alert"
      accessibilityLabel={`Device is offline. ${cachedAt ? 'Showing cached data from ' + cachedAt + '. ' : ''}${pendingCount > 0 ? pendingCount + ' actions waiting to sync.' : ''}`}
    >
      <Text style={[styles.icon, { color: colors.warning }]} accessibilityElementsHidden maxFontSizeMultiplier={2}>Offline</Text>
      <View>
        <Text style={[styles.title, { color: colors.warning }]} maxFontSizeMultiplier={2}>Offline</Text>
        {cachedAt ? (
          <Text style={[styles.subtitle, { color: colors.warning }]} maxFontSizeMultiplier={2}>Showing cached data from {cachedAt}</Text>
        ) : null}
        {pendingCount > 0 ? (
          <Text style={[styles.subtitle, { color: colors.warning }]} maxFontSizeMultiplier={2}>
            {pendingCount} action{pendingCount === 1 ? '' : 's'} waiting to sync
          </Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  icon: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
    opacity: 0.9,
  },
});
