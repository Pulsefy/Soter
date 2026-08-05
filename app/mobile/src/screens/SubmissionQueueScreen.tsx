import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { SubmissionStatusBadge } from '../components/SubmissionStatusBadge';
import { QueuedSyncAction, mapConflictErrorMessage, isConflictError } from '../services/syncQueue';
import { useSync } from '../contexts/SyncContext';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'SubmissionQueue'>;

type FilterTab = 'all' | 'pending' | 'failed' | 'conflict';

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
    conflictCount,
    flushNow,
    retryAction,
    requeueAction,
    discardAction,
  } = useSync();

  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [selectedAction, setSelectedAction] = useState<QueuedSyncAction | null>(null);

  const filteredItems = useMemo(() => {
    if (activeTab === 'pending') {
      return items.filter((i) => i.state === 'pending' || i.state === 'retrying');
    }
    if (activeTab === 'failed') {
      return items.filter((i) => i.state === 'failed');
    }
    if (activeTab === 'conflict') {
      return items.filter((i) => i.state === 'conflict');
    }
    return items;
  }, [items, activeTab]);

  const handleRequeue = async (actionId: string) => {
    if (selectedAction?.id === actionId) {
      setSelectedAction(null);
    }
    await requeueAction(actionId);
  };

  const handleDiscard = async (actionId: string) => {
    if (selectedAction?.id === actionId) {
      setSelectedAction(null);
    }
    await discardAction(actionId);
  };

  const renderItem = ({ item }: { item: QueuedSyncAction }) => {
    const actionLabel = ACTION_LABELS[item.type] ?? item.type;
    const isConflict = item.state === 'conflict' || isConflictError(item.lastError);
    const displayErrorMessage = isConflict
      ? mapConflictErrorMessage(item.lastError)
      : item.lastError;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleGroup}>
            <Text style={styles.cardTitle}>{actionLabel}</Text>
            <Text style={styles.cardSubtitle}>{getActionDescription(item)}</Text>
          </View>

          <SubmissionStatusBadge
            state={item.state}
            onRetry={() => handleRequeue(item.id)}
          />
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Retries</Text>
          <Text style={styles.detailValue}>
            {item.retryCount} / {item.maxRetries}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Updated</Text>
          <Text style={styles.detailValue}>{formatDateTime(item.updatedAt)}</Text>
        </View>

        {displayErrorMessage ? (
          <View style={isConflict ? styles.conflictBox : styles.errorBox}>
            <Text style={isConflict ? styles.conflictLabel : styles.errorLabel}>
              {isConflict ? 'Conflict Error' : 'Last Error'}
            </Text>
            <Text style={isConflict ? styles.conflictText : styles.errorText}>
              {displayErrorMessage}
            </Text>
          </View>
        ) : null}

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.inspectButton}
            onPress={() => setSelectedAction(item)}
            accessibilityRole="button"
            accessibilityLabel="Inspect item details"
            testID={`inspect-button-${item.id}`}
          >
            <Text style={styles.inspectButtonText}>Inspect Details</Text>
          </TouchableOpacity>

          {(item.state === 'failed' || item.state === 'conflict' || item.state === 'retrying') && (
            <TouchableOpacity
              style={styles.requeueButton}
              onPress={() => handleRequeue(item.id)}
              accessibilityRole="button"
              accessibilityLabel="Requeue item"
              testID={`requeue-button-${item.id}`}
            >
              <Text style={styles.requeueButtonText}>Requeue</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.discardButton}
            onPress={() => handleDiscard(item.id)}
            accessibilityRole="button"
            accessibilityLabel="Discard item"
            testID={`discard-button-${item.id}`}
          >
            <Text style={styles.discardButtonText}>Discard</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.summary}>
        <Text style={styles.title}>Submission Queue</Text>

        <Text style={styles.summaryText}>
          {isConnected ? 'Online' : 'Offline'} · {pendingCount} pending · {failedCount} failed · {conflictCount} conflict
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

      <View style={styles.tabsContainer}>
        {(['all', 'pending', 'failed', 'conflict'] as FilterTab[]).map((tab) => {
          const isActive = activeTab === tab;
          const count =
            tab === 'all'
              ? items.length
              : tab === 'pending'
              ? pendingCount
              : tab === 'failed'
              ? failedCount
              : conflictCount;

          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabButton, isActive && styles.activeTabButton]}
              onPress={() => setActiveTab(tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              testID={`filter-tab-${tab}`}
            >
              <Text style={[styles.tabText, isActive && styles.activeTabText]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)} ({count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filteredItems}
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
              {activeTab === 'all'
                ? 'Offline submissions will appear here until they are synced.'
                : `No items in ${activeTab} category.`}
            </Text>
          </View>
        }
      />

      {/* Inspect Details Modal */}
      {selectedAction ? (
        <Modal
          visible={Boolean(selectedAction)}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setSelectedAction(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <ScrollView contentContainerStyle={styles.modalScroll}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Inspect Submission Item</Text>
                  <SubmissionStatusBadge state={selectedAction.state} />
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Action Details</Text>
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Action ID:</Text>
                    <Text style={styles.modalValue}>{selectedAction.id}</Text>
                  </View>
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Type:</Text>
                    <Text style={styles.modalValue}>
                      {ACTION_LABELS[selectedAction.type] ?? selectedAction.type}
                    </Text>
                  </View>
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Created:</Text>
                    <Text style={styles.modalValue}>
                      {formatDateTime(selectedAction.createdAt)}
                    </Text>
                  </View>
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Last Updated:</Text>
                    <Text style={styles.modalValue}>
                      {formatDateTime(selectedAction.updatedAt)}
                    </Text>
                  </View>
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Retries:</Text>
                    <Text style={styles.modalValue}>
                      {selectedAction.retryCount} / {selectedAction.maxRetries}
                    </Text>
                  </View>
                </View>

                {selectedAction.lastError ? (
                  <View
                    style={
                      selectedAction.state === 'conflict' || isConflictError(selectedAction.lastError)
                        ? styles.conflictBox
                        : styles.errorBox
                    }
                  >
                    <Text
                      style={
                        selectedAction.state === 'conflict' || isConflictError(selectedAction.lastError)
                          ? styles.conflictLabel
                          : styles.errorLabel
                      }
                    >
                      {selectedAction.state === 'conflict' || isConflictError(selectedAction.lastError)
                        ? 'Clear Mobile Conflict Message'
                        : 'Backend Error Message'}
                    </Text>
                    <Text
                      style={
                        selectedAction.state === 'conflict' || isConflictError(selectedAction.lastError)
                          ? styles.conflictText
                          : styles.errorText
                      }
                    >
                      {mapConflictErrorMessage(selectedAction.lastError)}
                    </Text>

                    <Text style={[styles.modalLabel, { marginTop: 8 }]}>Raw Backend Response:</Text>
                    <Text style={styles.rawErrorText}>{selectedAction.lastError}</Text>
                  </View>
                ) : null}

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Payload Parameters</Text>
                  <Text style={styles.payloadCode}>
                    {JSON.stringify(selectedAction.payload, null, 2)}
                  </Text>
                </View>
              </ScrollView>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.modalRequeueBtn}
                  onPress={() => handleRequeue(selectedAction.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Requeue submission item"
                >
                  <Text style={styles.modalBtnText}>Requeue</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalDiscardBtn}
                  onPress={() => handleDiscard(selectedAction.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Discard submission item"
                >
                  <Text style={styles.modalBtnText}>Discard</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalCloseBtn}
                  onPress={() => setSelectedAction(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close inspection details"
                >
                  <Text style={styles.modalCloseText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
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
    tabsContainer: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 6,
      gap: 8,
    },
    tabButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: colors.background,
    },
    activeTabButton: {
      backgroundColor: colors.primary,
    },
    tabText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    activeTabText: {
      color: '#FFFFFF',
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
    conflictBox: {
      borderRadius: 6,
      padding: 10,
      backgroundColor: '#F3E8FF',
      gap: 4,
      borderWidth: 1,
      borderColor: '#D8B4FE',
    },
    conflictLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: '#6B21A8',
    },
    conflictText: {
      fontSize: 12,
      color: '#6B21A8',
      fontWeight: '600',
    },
    rawErrorText: {
      fontSize: 11,
      fontFamily: 'monospace',
      color: '#581C87',
    },
    actionRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 4,
    },
    inspectButton: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 4,
      backgroundColor: colors.border,
    },
    inspectButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    requeueButton: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 4,
      backgroundColor: colors.primary,
    },
    requeueButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    discardButton: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 4,
      backgroundColor: '#FEE2E2',
    },
    discardButtonText: {
      fontSize: 12,
      fontWeight: '600',
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
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    modalContent: {
      width: '100%',
      maxHeight: '85%',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      gap: 12,
    },
    modalScroll: {
      gap: 12,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    modalSection: {
      gap: 6,
    },
    modalSectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 2,
    },
    modalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    modalLabel: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    modalValue: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    payloadCode: {
      fontSize: 11,
      fontFamily: 'monospace',
      backgroundColor: colors.background,
      padding: 8,
      borderRadius: 6,
      color: colors.textPrimary,
    },
    modalFooter: {
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'flex-end',
      marginTop: 8,
    },
    modalRequeueBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 6,
    },
    modalDiscardBtn: {
      backgroundColor: '#FEE2E2',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 6,
    },
    modalBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    modalCloseBtn: {
      backgroundColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 6,
    },
    modalCloseText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
    },
  });