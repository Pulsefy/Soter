import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';
import { useBiometric } from '../contexts/BiometricContext';
import {
  AidDetails,
  ClaimStatus,
  fetchAidDetails,
  getMockAidDetails,
} from '../services/aidApi';
import { useSync } from '../contexts/SyncContext';
import { useSaverMode } from '../contexts/SaverModeContext';
import { SaverModeBanner } from '../components/SaverModeBanner';

type Props = NativeStackScreenProps<RootStackParamList, 'AidDetails'>;

export const AidDetailsScreen: React.FC<Props> = ({ navigation, route }) => {
  const { aidId } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { biometricEnabled, authenticate } = useBiometric();
  const { active: saverModeActive, source: saverModeSource } = useSaverMode();

  // null = not yet attempted, true = granted, false = denied
  const [authState, setAuthState] = useState<'idle' | 'pending' | 'granted' | 'denied'>('idle');
  const [details, setDetails] = useState<AidDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const {
    getActionsForAid,
    isConnected,
    isSyncing,
    lastCompletedAction,
    queueClaimConfirmation,
    queueStatusRefresh,
  } = useSync();
  const pendingActions = getActionsForAid(aidId);
  const hasPendingRefresh = pendingActions.some(
    (item) => item.type === 'status-refresh' && item.state !== 'failed',
  );
  const hasPendingConfirmation = pendingActions.some(
    (item) => item.type === 'claim-confirmation' && item.state !== 'failed',
  );
  const failedActions = pendingActions.filter((item) => item.state === 'failed');

  const requestAuth = useCallback(async () => {
    if (!biometricEnabled) {
      setAuthState('granted');
      return;
    }
    setAuthState('pending');
    const success = await authenticate();
    setAuthState(success ? 'granted' : 'denied');
  }, [biometricEnabled, authenticate]);

  // Trigger auth on mount
  useEffect(() => {
    void requestAuth();
  }, [requestAuth]);

  const loadDetails = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const data = await fetchAidDetails(aidId);
        setDetails(data);
        setError(null);
      } catch {
        setError('Unable to reach the server. Showing last known data.');
        setDetails((current) => current ?? getMockAidDetails(aidId));
      } finally {
        const now = new Date().toISOString();
        setLastUpdated(now);
        setLoading(false);
        setRefreshing(false);
      }
    },
    [aidId],
  );

  useEffect(() => {
    if (authState === 'granted') {
      void loadDetails(false);
    }
  }, [authState, loadDetails]);

  // ── Periodic auto-refresh (normal mode only) ──────────────────────────────
  // In normal mode, refresh every 30 s while the screen is focused.
  // In saver mode this is disabled – the user must pull-to-refresh.
  useEffect(() => {
    if (authState !== 'granted' || saverModeActive) return;
    const id = setInterval(() => {
      void loadDetails(true);
    }, 30_000);
    return () => clearInterval(id);
  }, [authState, loadDetails, saverModeActive]);

  // Sync background effect
  useEffect(() => {
    if (!lastCompletedAction) {
      return;
    }

    const payload = lastCompletedAction.action.payload as { aidId?: string };
    if (payload.aidId !== aidId) {
      return;
    }

    if (lastCompletedAction.action.type === 'status-refresh') {
      setDetails(lastCompletedAction.result as AidDetails);
      setError(null);
      setSyncMessage('Status refreshed after reconnecting.');
      setLastUpdated(lastCompletedAction.completedAt);
      return;
    }

    if (lastCompletedAction.action.type === 'claim-confirmation') {
      setSyncMessage('Claim confirmation synced successfully.');
      void loadDetails(false);
    }
  }, [aidId, lastCompletedAction, loadDetails]);

  const handleRefreshStatus = useCallback(async () => {
    setRefreshing(true);

    try {
      const result = await queueStatusRefresh(aidId);

      if (result.status === 'completed') {
        setDetails(result.result);
        setError(null);
        setSyncMessage('Status is up to date.');
        setLastUpdated(new Date().toISOString());
      } else {
        setSyncMessage(
          isConnected
            ? 'Refresh queued. We will retry automatically if the network stays unstable.'
            : 'Refresh queued. It will sync automatically when connectivity returns.',
        );
      }
    } catch {
      setError('Status refresh failed. Please try again.');
    } finally {
      setRefreshing(false);
    }
  }, [aidId, isConnected, queueStatusRefresh]);

  const handleConfirmClaim = useCallback(async () => {
    if (!details) {
      return;
    }

    setConfirming(true);

    try {
      const result = await queueClaimConfirmation(aidId, details.claimId);

      if (result.status === 'completed') {
        setSyncMessage('Claim confirmation submitted.');
        await loadDetails(false);
      } else {
        setSyncMessage(
          isConnected
            ? 'Claim confirmation queued for automatic retry.'
            : 'Claim confirmation saved offline and will sync when connectivity returns.',
        );
      }
    } catch {
      setError('Claim confirmation failed. Please try again.');
    } finally {
      setConfirming(false);
    }
  }, [aidId, details, isConnected, loadDetails, queueClaimConfirmation]);

  // ── Auth states ──────────────────────────────────────────────────────────

  if (authState === 'idle' || authState === 'pending') {
    return (
      <View
        style={styles.centered}
        accessible
        accessibilityLabel="Verifying identity, please wait"
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator
          size="large"
          color={colors.brand.primary}
          accessibilityElementsHidden
        />
        <Text style={styles.subtitle}>Verifying identity…</Text>
      </View>
    );
  }

  if (authState === 'denied') {
    return (
      <View
        style={styles.centered}
        accessible
        accessibilityLabel="Authentication required. Biometric verification is needed to view this screen."
      >
        <Text style={styles.lockIcon} accessibilityElementsHidden>🔒</Text>
        <Text style={styles.title}>Authentication Required</Text>
        <Text style={styles.subtitle}>
          Biometric verification is needed to view this screen.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Try biometric authentication again"
          style={[styles.button, { backgroundColor: colors.brand.primary }]}
          onPress={requestAuth}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // authState === 'granted'
  if (loading || !details) {
    return (
      <View
        style={styles.centered}
        accessible
        accessibilityLabel="Loading aid details, please wait"
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator
          size="large"
          color={colors.brand.primary}
          accessibilityElementsHidden
        />
        <Text style={styles.subtitle}>Loading aid details...</Text>
      </View>
    );
  }

  const statusLabel = formatStatus(details.status);
  const pillStyle = statusPillStyle(details.status, colors);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Saver Mode Banner ──────────────────────────────────────────── */}
      <SaverModeBanner visible={saverModeActive} source={saverModeSource} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {details.title}
        </Text>
        <Text style={styles.subtitle}>Package ID: {details.id}</Text>
        <Text style={styles.description}>{details.description}</Text>
        <View
          style={[styles.statusPill, { backgroundColor: pillStyle.backgroundColor }]}
          accessible
          accessibilityLabel={`Status: ${statusLabel}`}
        >
          <Text
            style={[styles.statusText, { color: pillStyle.textColor }]}
            importantForAccessibility="no-hide-descendants"
          >
            {statusLabel}
          </Text>
        </View>
      </View>

      {/* ── Error notice ────────────────────────────────────────────────── */}
      {error ? (
        <View
          style={styles.notice}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={error}
        >
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      {/* ── Sync UI ──────────────────────────────────────────────────────── */}
      {syncMessage ? (
        <View style={styles.syncNotice}>
          <Text style={styles.syncNoticeText}>{syncMessage}</Text>
        </View>
      ) : null}

      {pendingActions.length > 0 ? (
        <View style={styles.syncCard}>
          <Text style={styles.sectionTitle}>Sync Status</Text>
          <Text style={styles.syncCardText}>
            {pendingActions.length} pending action{pendingActions.length === 1 ? '' : 's'}
            {isSyncing ? ' are syncing now.' : ' saved locally.'}
          </Text>
          {!isConnected ? (
            <Text style={styles.syncCardMeta}>
              They will retry automatically when the device reconnects.
            </Text>
          ) : null}
          {failedActions.length > 0 ? (
            <Text style={styles.syncCardMeta}>
              {failedActions.length} action{failedActions.length === 1 ? '' : 's'} reached the retry limit.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── Recipient ───────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Recipient
        </Text>
        <View style={styles.card}>
          <InfoRow label="Name" value={details.recipient.name} colors={colors} />
          <InfoRow label="Recipient ID" value={details.recipient.id} colors={colors} />
          <InfoRow label="Wallet" value={details.recipient.wallet} colors={colors} />
        </View>
      </View>

      {/* ── Package Details ─────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Package Details
        </Text>
        <View style={styles.card}>
          <InfoRow label="Token Type" value={details.tokenType} colors={colors} />
          <InfoRow
            label="Amount"
            value={`${details.amount} ${details.tokenType}`}
            colors={colors}
          />
          <InfoRow label="Expiry Date" value={formatDate(details.expiryDate)} colors={colors} />
          <InfoRow label="Claim ID" value={details.claimId} colors={colors} />
        </View>
      </View>

      {/* ── Claim Status ────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Claim Status
        </Text>
        <StepProgress status={details.status} colors={colors} />
        <Text style={styles.statusCaption}>
          Current status: {statusLabel}
        </Text>
      </View>

      {/* ── Refresh Button ──────────────────────────────────────────────── */}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={refreshing ? 'Refreshing status' : 'Refresh status'}
        accessibilityHint="Fetches the latest aid package status from the server"
        accessibilityState={{ disabled: refreshing, busy: refreshing }}
        style={[
          styles.button,
          { backgroundColor: colors.brand.primary },
          refreshing ? styles.buttonDisabled : null,
        ]}
        onPress={handleRefreshStatus}
        disabled={refreshing || hasPendingRefresh}
        activeOpacity={0.8}
      >
        {refreshing ? (
          <ActivityIndicator
            size="small"
            color="#FFFFFF"
            accessibilityElementsHidden
          />
        ) : (
          <Text style={styles.buttonText}>
            {hasPendingRefresh ? 'Refresh Queued' : 'Refresh Status'}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityRole="button"
        style={[
          styles.button,
          styles.secondaryButton,
          confirming || hasPendingConfirmation ? styles.buttonDisabled : null,
        ]}
        onPress={handleConfirmClaim}
        disabled={confirming || hasPendingConfirmation}
        activeOpacity={0.8}
      >
        {confirming ? (
          <ActivityIndicator size="small" color={colors.brand.primary} />
        ) : (
          <Text style={styles.secondaryButtonText}>
            {hasPendingConfirmation ? 'Claim Confirmation Queued' : 'Confirm Claim'}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.button, { backgroundColor: colors.success }]}
        onPress={() => navigation.navigate('EvidenceUpload', { aidId })}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>Upload Evidence</Text>
      </TouchableOpacity>

      {lastUpdated ? (
        <Text
          style={styles.lastUpdated}
          accessibilityLabel={`Last updated ${formatDateTime(lastUpdated)}`}
        >
          Last updated {formatDateTime(lastUpdated)}
        </Text>
      ) : null}
    </ScrollView>
  );
};

// ── Sub-components ───────────────────────────────────────────────────────────

const InfoRow = ({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: AppColors;
}) => (
  <View
    style={stylesShared.infoRow}
    accessible
    accessibilityLabel={`${label}: ${value}`}
  >
    <Text
      style={[stylesShared.infoLabel, { color: colors.textSecondary }]}
      importantForAccessibility="no-hide-descendants"
    >
      {label}
    </Text>
    <Text
      style={[stylesShared.infoValue, { color: colors.textPrimary }]}
      importantForAccessibility="no-hide-descendants"
    >
      {value}
    </Text>
  </View>
);

const StepProgress = ({
  status,
  colors,
}: {
  status: ClaimStatus;
  colors: AppColors;
}) => {
  const steps: Array<{ key: ClaimStatus; label: string }> = [
    { key: 'requested', label: 'Requested' },
    { key: 'verified', label: 'Verified' },
    { key: 'disbursed', label: 'Disbursed' },
  ];
  const activeIndex = steps.findIndex((step) => step.key === status);

  return (
    <View
      style={stylesShared.progressWrapper}
      accessible
      accessibilityLabel={`Claim progress: step ${activeIndex + 1} of ${steps.length}, ${steps[activeIndex]?.label ?? status}`}
    >
      {steps.map((step, index) => {
        const isComplete = index <= activeIndex;
        const isLast = index === steps.length - 1;
        const stepLabel = isComplete
          ? `Step ${index + 1}: ${step.label}, completed`
          : `Step ${index + 1}: ${step.label}, not yet reached`;

        return (
          <View
            key={step.key}
            style={stylesShared.progressItem}
            accessible
            accessibilityLabel={stepLabel}
          >
            <View
              style={[
                stylesShared.progressCircle,
                {
                  backgroundColor: isComplete ? colors.brand.primary : colors.surface,
                  borderColor: isComplete ? colors.brand.primary : colors.border,
                },
              ]}
              accessibilityElementsHidden
            >
              <Text
                style={[
                  stylesShared.progressText,
                  { color: isComplete ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                {index + 1}
              </Text>
            </View>
            <Text
              style={[stylesShared.progressLabel, { color: colors.textSecondary }]}
              accessibilityElementsHidden
            >
              {step.label}
            </Text>
            {!isLast ? (
              <View
                style={[
                  stylesShared.progressLine,
                  { backgroundColor: isComplete ? colors.brand.primary : colors.border },
                ]}
                accessibilityElementsHidden
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatStatus = (status: ClaimStatus) =>
  status.charAt(0).toUpperCase() + status.slice(1);

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const statusPillStyle = (status: ClaimStatus, colors: AppColors) => {
  switch (status) {
    case 'verified':
      return { backgroundColor: colors.infoBg, textColor: colors.info };
    case 'disbursed':
      return { backgroundColor: colors.success, textColor: '#FFFFFF' };
    case 'requested':
    default:
      return { backgroundColor: colors.warningBg, textColor: colors.warning };
  }
};

// ── Shared styles ─────────────────────────────────────────────────────────────

const stylesShared = StyleSheet.create({
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 13,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  progressWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 8,
  },
  progressItem: {
    flex: 1,
    alignItems: 'center',
  },
  progressCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressText: {
    fontSize: 12,
    fontWeight: '700',
  },
  progressLabel: {
    marginTop: 6,
    fontSize: 11,
    textAlign: 'center',
  },
  progressLine: {
    position: 'absolute',
    height: 2,
    right: -40,
    top: 14,
    width: 80,
  },
});

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 20,
      paddingBottom: 32,
      gap: 18,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
      padding: 32,
      gap: 16,
    },
    lockIcon: {
      fontSize: 48,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: 16,
      color: colors.textSecondary,
      marginTop: 8,
    },
    header: {
      gap: 6,
    },
    statusPill: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      marginTop: 6,
    },
    statusText: {
      fontSize: 12,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    section: {
      gap: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    description: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 6,
    },
    statusCaption: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 4,
    },
    notice: {
      backgroundColor: colors.warningBg,
      borderRadius: 10,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.warningBorder,
    },
    noticeText: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    syncNotice: {
      backgroundColor: colors.infoBg,
      borderRadius: 10,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.info,
    },
    syncNoticeText: {
      color: colors.info,
      fontSize: 13,
    },
    syncCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 6,
    },
    syncCardText: {
      fontSize: 14,
      color: colors.textPrimary,
    },
    syncCardMeta: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    button: {
      paddingVertical: 14,
      paddingHorizontal: 32,
      minHeight: 44,
      borderRadius: 12,
      alignItems: 'center',
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    buttonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
    },
    secondaryButton: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.brand.primary,
    },
    secondaryButtonText: {
      color: colors.brand.primary,
      fontSize: 16,
      fontWeight: '700',
    },
    lastUpdated: {
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 4,
    },
  });