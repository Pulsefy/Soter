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
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { TaskItem, fetchTaskList, getMockTaskList } from '../services/taskApi';
import { cacheTaskList, loadCachedTaskList, getTaskCacheTimestamp } from '../services/taskCache';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { OfflineBanner } from '../components/OfflineBanner';
import { DataFreshnessIndicator } from '../components/DataFreshnessIndicator';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';
import { formatDate } from '../i18n/formatters';

type Props = NativeStackScreenProps<RootStackParamList, 'TaskList'>;

const STATUS_COLORS: Record<string, string> = {
  'completed': '#16A34A',
  'in-progress': '#D97706',
  'pending': '#6B7280',
};

const DUE_STATE_COLORS: Record<string, string> = {
  'due-today': '#D97706',
  'overdue': '#DC2626',
  'upcoming': '#2563EB',
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  'completed': 'tasks.completed',
  'in-progress': 'tasks.inProgress',
  'pending': 'tasks.pending',
};

const DUE_STATE_LABEL_KEYS: Record<string, string> = {
  'due-today': 'tasks.dueToday',
  'overdue': 'tasks.overdue',
  'upcoming': 'tasks.upcoming',
};

export const TaskListScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [taskList, setTaskList] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const fresh = await fetchTaskList();
      if (isRefresh) setRefreshMessage(t('tasks.refreshed'));
      setTaskList(fresh);
      setIsCached(false);
      await cacheTaskList(fresh);
      setCachedAt(null);
    } catch {
      if (isRefresh) setRefreshMessage(t('tasks.refreshFailed'));
      const cached = await loadCachedTaskList();
      if (cached && cached.length > 0) {
        setTaskList(cached);
        setIsCached(true);
        const ts = await getTaskCacheTimestamp();
        setCachedAt(ts);
      } else {
        // Fallback to mock data if no cache exists
        const mock = getMockTaskList();
        setTaskList(mock);
        setIsCached(true);
        setCachedAt(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  const handleReconnect = useCallback(async () => {
    if (!isCached) return;
    await loadData(false);
  }, [isCached, loadData]);

  const { isConnected } = useNetworkStatus(handleReconnect);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const renderItem = ({ item }: { item: TaskItem }) => {
    const statusKey = item.status;
    const dueStateKey = item.dueState;
    const statusKeyPath = STATUS_LABEL_KEYS[statusKey];
    const dueStateKeyPath = DUE_STATE_LABEL_KEYS[dueStateKey];
    const statusLabel = statusKeyPath ? t(statusKeyPath) : item.status;
    const dueStateLabel = dueStateKeyPath ? t(dueStateKeyPath) : item.dueState;
    const formattedDate = formatDate(new Date(item.dueDate).getTime(), { ms: true });

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>
            {item.title}
          </Text>
          <View style={styles.badgesRow}>
            <View
              style={[
                styles.badge,
                { backgroundColor: STATUS_COLORS[statusKey] || '#6B7280' },
              ]}
            >
              <Text style={styles.badgeText}>{statusLabel.toUpperCase()}</Text>
            </View>
            <View
              style={[
                styles.badge,
                { backgroundColor: DUE_STATE_COLORS[dueStateKey] || '#2563EB' },
              ]}
            >
              <Text style={styles.badgeText}>{dueStateLabel.toUpperCase()}</Text>
            </View>
          </View>
        </View>
        
        <Text style={styles.cardDescription}>{t('tasks.packageId', { id: item.assignedPackageId })}</Text>
        <Text style={styles.cardDescription}>{t('tasks.due')}: {formattedDate}</Text>
        
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('AidDetails', { aidId: item.assignedPackageId })}
            accessibilityRole="button"
            accessibilityLabel={t('tasks.viewDetails')}
          >
            <Text style={styles.actionButtonText}>{t('tasks.detail')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('Scanner')}
            accessibilityRole="button"
            accessibilityLabel={t('tasks.scan')}
          >
            <Text style={styles.actionButtonText}>{t('tasks.scan')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('AidDetails', { aidId: item.assignedPackageId })}
            accessibilityRole="button"
            accessibilityLabel={t('tasks.verify')}
          >
            <Text style={styles.actionButtonText}>{t('tasks.verify')}</Text>
          </TouchableOpacity>
        </View>
      </View>
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
        <Text style={styles.loadingText}>{t('tasks.loading')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <OfflineBanner visible={!isConnected} cachedAt={cachedAt} pendingCount={0} />
      <DataFreshnessIndicator isCached={isCached} isConnected={isConnected} cachedAt={cachedAt} refreshing={refreshing} refreshMessage={refreshMessage} onRefresh={() => loadData(true)} />

      <FlatList
        data={taskList}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor={colors.textPrimary}
            accessibilityLabel={t('tasks.pullToRefresh')}
          />
        }
        ListHeaderComponent={
          isCached && isConnected ? (
            <View
              style={styles.staleNotice}
              accessible
              accessibilityRole="alert"
              accessibilityLabel={t('tasks.cachedDataHint')}
            >
              <Text style={styles.staleText}>
                {t('tasks.cachedData')}
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.centered} accessible accessibilityLabel={t('tasks.noTasks')}>
            <Text style={styles.emptyText}>{t('tasks.noTasks')}.</Text>
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
    },
    cardHeader: {
      flexDirection: 'column',
      justifyContent: 'flex-start',
      alignItems: 'flex-start',
      marginBottom: 8,
      gap: 8,
    },
    cardTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    badgesRow: {
      flexDirection: 'row',
      gap: 8,
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
      marginBottom: 4,
    },
    actionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 16,
      gap: 8,
    },
    actionButton: {
      flex: 1,
      backgroundColor: colors.brand.primary,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: 'center',
    },
    actionButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '600',
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
    emptyText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
  });
