import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export const DEFAULT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

type Props = {
  cachedAt?: string | null;
  isCached: boolean;
  isConnected: boolean;
  onRefresh: () => void;
  refreshing?: boolean;
  refreshMessage?: string | null;
  staleThresholdMs?: number;
};

export const formatAge = (cachedAt: string | null | undefined, now = Date.now()): string | null => {
  if (!cachedAt) return null;
  const timestamp = new Date(cachedAt).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

export const DataFreshnessIndicator: React.FC<Props> = ({
  cachedAt,
  isCached,
  isConnected,
  onRefresh,
  refreshing = false,
  refreshMessage,
  staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
}) => {
  const { colors } = useTheme();
  const age = formatAge(cachedAt);
  const isStale = Boolean(cachedAt && Date.now() - new Date(cachedAt).getTime() >= staleThresholdMs);
  const source = isCached ? 'offline-cached' : 'freshly fetched';
  const label = isCached
    ? `Showing offline-cached data from ${age ?? 'an unknown time'}.${isStale ? ' This data is stale.' : ''}`
    : 'Showing freshly fetched data.';

  return (
    <View
      style={[styles.container, { backgroundColor: isStale ? colors.warningBg : colors.surface, borderColor: isStale ? colors.warningBorder : colors.border }]}
      accessible
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
    >
      <View style={styles.copy}>
        <Text style={[styles.title, { color: isStale ? colors.warning : colors.textPrimary }]}>
          {isCached ? (isStale ? 'Stale cached data' : 'Offline-cached data') : 'Fresh data'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {isCached ? `Updated ${age ?? 'at an unknown time'} · ${source}` : source}
        </Text>
        {refreshMessage ? <Text style={[styles.message, { color: colors.info }]}>{refreshMessage}</Text> : null}
      </View>
      <TouchableOpacity
        style={[styles.button, { borderColor: colors.brand.primary }]}
        onPress={onRefresh}
        disabled={refreshing}
        accessibilityRole="button"
        accessibilityLabel={refreshing ? 'Refreshing data' : 'Refresh data'}
        accessibilityState={{ busy: refreshing, disabled: refreshing }}
      >
        <Text style={[styles.buttonText, { color: colors.brand.primary }]}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 12, marginHorizontal: 16, marginTop: 10, gap: 12 },
  copy: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 3 },
  message: { fontSize: 12, marginTop: 4 },
  button: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12 },
  buttonText: { fontSize: 13, fontWeight: '700' },
});
