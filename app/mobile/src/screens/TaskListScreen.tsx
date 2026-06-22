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
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';

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

const STATUS_LABELS: Record<string, string> = {
  'completed': 'Completed',
  'in-progress': 'In Progress',
  'pending': 'Pending',
};

const DUE_STATE_LABELS: Record<string, string> = {
  'due-today': 'Due Today',
  'overdue': 'Overdue',
  'upcoming': 'Upcoming',
};

export const TaskListScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [taskList, setTaskList] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const fresh = await fetchTaskList();
      setTaskList(fresh);
      setIsCached(false);
      await cacheTaskList(fresh);
      setCachedAt(null);
    } catch {
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
  }, []);

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
    const statusLabel = STATUS_LABELS[statusKey] ?? item.status;
    const dueStateLabel = DUE_STATE_LABELS[dueStateKey] ?? item.dueState;
    const formattedDate = new Date(item.dueDate).toLocaleDateString();

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
        
        <Text style={styles.cardDescription}>Package ID: {item.assignedPackageId}</Text>
        <Text style={styles.cardDescription}>Due: {formattedDate}</Text>
        
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('AidDetails', { aidId: item.assignedPackageId })}
            accessibilityRole="button"
            accessibilityLabel="View details"
          >
            <Text style={styles.actionButtonText}>Detail</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('Scanner')}
            accessibilityRole="button"
            accessibilityLabel="Scan QR"
          >
            <Text style={styles.actionButtonText}>Scan</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('AidDetails', { aidId: item.assignedPackageId })}
            accessibilityRole="button"
            accessibilityLabel="Verify action"
          >
            <Text style={styles.actionButtonText}>Verify</Text>
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
        <Text style={styles.loadingText}>Loading tasks...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <OfflineBanner visible={!isConnected} cachedAt={cachedAt} pendingCount={0} />

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
            accessibilityLabel="Pull to refresh tasks"
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
          <View style={styles.centered} accessible accessibilityLabel="No tasks found">
            <Text style={styles.emptyText}>No tasks found.</Text>
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
