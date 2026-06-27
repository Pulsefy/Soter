import React, { useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { SubmissionStatusBadge } from '../components/SubmissionStatusBadge';
import { QueuedSyncAction } from '../services/syncQueue';
import { useSync } from '../contexts/SyncContext';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'SubmissionQueue'>;

const ACTION_LABELS: Record<string, string> = {
  'status-refresh': 'Status Refresh',
  'claim-confirmation': 'Claim Confirmation',
  'evidence-upload': 'Evidence Upload',
  'claim-submission': 'Claim Submission',
};

const formatDateTime = (value: string | null) => {
  if (!value) return 'Not available';

  return new Date(value).toLocaleString();
};

const getActionDescription = (action: QueuedSyncAction) => {
  const payload = action.payload as {
    aidId?: string;
    claimId?: string;
  };

  if (payload.claimId) {
    return `Claim ID: ${payload.claimId}`;
  }

  if (payload.aidId) {
    return `Aid ID: ${payload.aidId}`;
  }

  return 'No reference ID';
};

export const SubmissionQueueScreen: React.FC<Props> = () => {
  const {
    items,
    isSyncing,
    isConnected,
    lastSyncAt,
    lastSyncError,
    pendingCount,
    failedCount,
    flushNow,
    retryAction,
  } = useSync();

  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const renderItem = ({ item }: { item: QueuedSyncAction }) => {
    const actionLabel = ACTION_LABELS[item.type] ?? item.type;
    const canRetry = item.state === 'failed';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleGroup}>
            <Text style={styles.cardTitle}>{actionLabel}</Text>
            <Text style={styles.cardSubtitle}>{getActionDescription(item)}</Text>
          </View>

          <SubmissionStatusBadge
            state={item.state}
            onRetry={canRetry ? () => retryAction(item.id) : undefined}
          />
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Retries</Text>
          <Text style={styles.detailValue}>
            {item.retryCount} / {item.maxRetries}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Next retry</Text>
          <Text style={styles.detailValue}>{formatDateTime(item.nextRetryAt)}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Updated</Text>
          <Text style={styles.detailValue}>{formatDateTime(item.updatedAt)}</Text>
        </View>

        {item.lastError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorLabel}>Last error</Text>
            <Text style={styles.errorText}>{item.lastError}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.summary}>
        <Text style={styles.title}>Submission Queue</Text>

        <Text style={styles.summaryText}>
          {isConnected ? 'Online' : 'Offline'} · {pendingCount} pending · {failedCount} failed
        </Text>

        <Text style={styles.summaryText}>
          Last sync: {formatDateTime(lastSyncAt)}
        </Text>

        {lastSyncError ? (
          <Text style={styles.errorSummary}>Last sync error: {lastSyncError}</Text>
        ) : null}

        <TouchableOpacity
          style={[styles.refreshButton, isSyncing && styles.refreshButtonDisabled]}
          onPress={flushNow}
          disabled={isSyncing}
          accessibilityRole="button"
          accessibilityLabel="Sync queued submissions now"
        >
          <Text style={styles.refreshButtonText}>
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isSyncing}
            onRefresh={flushNow}
            tintColor={colors.textPrimary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No queued submissions</Text>
            <Text style={styles.emptyText}>
              Offline submissions will appear here until they are synced.
            </Text>
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
    summary: {
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
      gap: 6,
    },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    summaryText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    errorSummary: {
      fontSize: 13,
      color: colors.error,
    },
    refreshButton: {
      marginTop: 8,
      alignSelf: 'flex-start',
      borderRadius: 6,
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    refreshButtonDisabled: {
      opacity: 0.6,
    },
    refreshButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
    list: {
      padding: 16,
      gap: 12,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 8,
      padding: 16,
      gap: 10,
      elevation: 2,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    cardTitleGroup: {
      flex: 1,
      gap: 4,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    cardSubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    detailLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    detailValue: {
      flex: 1,
      textAlign: 'right',
      fontSize: 13,
      color: colors.textPrimary,
    },
    errorBox: {
      borderRadius: 6,
      padding: 10,
      backgroundColor: '#FEE2E2',
      gap: 4,
    },
    errorLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: '#991B1B',
    },
    errorText: {
      fontSize: 12,
      color: '#991B1B',
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      gap: 8,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    emptyText: {
      textAlign: 'center',
      fontSize: 14,
      color: colors.textSecondary,
    },
  });