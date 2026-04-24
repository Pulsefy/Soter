import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  TextInput,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { AidPackage, getAidPackages } from '../services/api';
import { cacheAidList, loadCachedAidList, getCacheTimestamp } from '../services/aidCache';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { OfflineBanner } from '../components/OfflineBanner';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';
import { useSync } from '../contexts/SyncContext';
import { useSaverMode } from '../contexts/SaverModeContext';
import { SaverModeBanner } from '../components/SaverModeBanner';

type Props = NativeStackScreenProps<RootStackParamList, 'AidOverview'>;

const STATUS_COLORS: Record<string, string> = {
  active: '#16A34A',
  pending: '#D97706',
  closed: '#6B7280',
};

// Human-readable status labels for screen readers
const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  pending: 'Pending',
  closed: 'Closed',
};

export const AidOverviewScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [aidList, setAidList] = useState<AidPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { pendingCount, failedCount, isSyncing: isQueueSyncing } = useSync();
  const { active: saverModeActive, source: saverModeSource } = useSaverMode();

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const fresh = await getAidPackages();
      setAidList(fresh);
      setIsCached(false);
      await cacheAidList(fresh);
      setCachedAt(null);
    } catch {
      const cached = await loadCachedAidList();
      if (cached && cached.length > 0) {
        setAidList(cached);
        setIsCached(true);
        const ts = await getCacheTimestamp();
        setCachedAt(ts);
      } else {
        setAidList([]);
        setIsCached(true);
        setCachedAt(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleReconnect = useCallback(async () => {
    if (!isCached) return;
    setSyncing(true);
    await loadData(false);
    setSyncing(false);
  }, [isCached, loadData]);

  const { isConnected } = useNetworkStatus(handleReconnect);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredAidList = useMemo(() => {
    if (!searchQuery) return aidList;
    const lowerQuery = searchQuery.toLowerCase();
    return aidList.filter(
      (item) =>
        item.id.toLowerCase().includes(lowerQuery) ||
        item.title.toLowerCase().includes(lowerQuery),
    );
  }, [aidList, searchQuery]);

  const renderItem = ({ item }: { item: AidPackage }) => {
    const statusKey = item.status.toLowerCase();
    const statusLabel = STATUS_LABELS[statusKey] ?? item.status;
    const formattedDate = new Date(item.date).toLocaleDateString();

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('AidDetails', { aidId: item.id })}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ID ${item.id}, status ${statusLabel}, amount $${item.amount}, date ${formattedDate}`}
        accessibilityHint="Opens the full details for this aid package"
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>
            {item.title}{' '}
            <Text style={styles.idText}>(#{item.id})</Text>
          </Text>
          {/* Badge is decorative — the parent button label already includes status */}
          <View
            style={[
              styles.badge,
              {
                backgroundColor:
                  STATUS_COLORS[statusKey] || '#16A34A',
              },
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.badgeText}>{item.status.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.cardDescription}>Amount: ${item.amount}</Text>
        <Text style={styles.cardLocation}>Date: {formattedDate}</Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator
          size="large"
          color={colors.textPrimary}
          accessibilityElementsHidden
        />
        <Text style={styles.loadingText}>Loading aid operations...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <SaverModeBanner visible={saverModeActive} source={saverModeSource} />
      <OfflineBanner visible={!isConnected} cachedAt={cachedAt} pendingCount={pendingCount} />

      {/* Resolved sync banner: dynamic condition + accessibility */}
      {(syncing || isQueueSyncing) && (
        <View
          style={styles.syncBanner}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel="Syncing latest data"
        >
          <ActivityIndicator
            size="small"
            color={colors.brand.primary}
            accessibilityElementsHidden
          />
          <Text style={styles.syncText}>
            {pendingCount > 0
              ? `Syncing ${pendingCount} pending action${pendingCount === 1 ? '' : 's'}...`
              : 'Syncing latest data...'}
          </Text>
        </View>
      )}

      {pendingCount > 0 && isConnected && !isQueueSyncing ? (
        <View style={styles.queueBanner}>
          <Text style={styles.queueText}>
            {pendingCount} action{pendingCount === 1 ? '' : 's'} queued for retry.
          </Text>
        </View>
      ) : null}

      {failedCount > 0 ? (
        <View style={styles.failedBanner}>
          <Text style={styles.failedText}>
            {failedCount} sync action{failedCount === 1 ? '' : 's'} need attention.
          </Text>
        </View>
      ) : null}

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by ID or Title..."
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search aid packages"
          accessibilityHint="Filter the list by entering an ID or title"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={filteredAidList}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor={colors.textPrimary}
            accessibilityLabel="Pull to refresh aid packages"
          />
        }
        ListHeaderComponent={
          isCached && isConnected ? (
            <View
              style={styles.staleNotice}
              accessible
              accessibilityRole="alert"
              accessibilityLabel="Showing cached data. Pull down to refresh."
            >
              <Text style={styles.staleText}>
                Showing cached data. Pull to refresh.
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.centered} accessible accessibilityLabel="No aid operations found">
            <Text style={styles.emptyText}>No aid operations found.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    loadingText: {
      marginTop: 12,
      fontSize: 14,
      color: colors.textSecondary,
    },
    searchContainer: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 4,
    },
    searchInput: {
      backgroundColor: colors.surface,
      borderRadius: 8,
      // Minimum 44 pt height (WCAG 2.5.5)
      minHeight: 44,
      padding: 12,
      color: colors.textPrimary,
      borderWidth: 1,
      borderColor: colors.border,
      fontSize: 16,
    },
    list: {
      padding: 16,
      gap: 12,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      elevation: 2,
      // Minimum 44 pt height satisfied by content padding
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
      flex: 1,
      marginRight: 8,
    },
    idText: {
      fontSize: 14,
      fontWeight: 'normal',
      color: colors.textSecondary,
    },
    badge: {
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    badgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    cardDescription: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: 8,
    },
    cardLocation: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    syncBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      paddingVertical: 8,
      gap: 8,
    },
    syncText: {
      fontSize: 13,
      color: colors.brand.primary,
    },
    staleNotice: {
      backgroundColor: colors.surface,
      borderRadius: 8,
      padding: 10,
      marginBottom: 8,
    },
    staleText: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    queueBanner: {
      backgroundColor: colors.infoBg,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    queueText: {
      fontSize: 13,
      color: colors.info,
      textAlign: 'center',
    },
    failedBanner: {
      backgroundColor: colors.warningBg,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    failedText: {
      fontSize: 13,
      color: colors.warning,
      textAlign: 'center',
    },
    emptyText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
  });