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

type Props = NativeStackScreenProps<RootStackParamList, 'AidDetails'>;

export const AidDetailsScreen: React.FC<Props> = ({ route }) => {
  const { aidId } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { biometricEnabled, authenticate } = useBiometric();

  // null = not yet attempted, true = granted, false = denied
  const [authState, setAuthState] = useState<'idle' | 'pending' | 'granted' | 'denied'>('idle');
  const [details, setDetails] = useState<AidDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

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

  if (authState === 'idle' || authState === 'pending') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
        <Text style={styles.subtitle}>Verifying identity…</Text>
      </View>
    );
  }

  if (authState === 'denied') {
    return (
      <View style={styles.centered}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.title}>Authentication Required</Text>
        <Text style={styles.subtitle}>
          Biometric verification is needed to view this screen.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
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
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
        <Text style={styles.subtitle}>Loading aid details...</Text>
      </View>
    );
  }

  const statusLabel = formatStatus(details.status);
  const pillStyle = statusPillStyle(details.status, colors);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{details.title}</Text>
        <Text style={styles.subtitle}>Package ID: {details.id}</Text>
        <Text style={styles.description}>{details.description}</Text>
        <View style={[styles.statusPill, { backgroundColor: pillStyle.backgroundColor }]}>
          <Text
            style={[
              styles.statusText,
              { color: pillStyle.textColor },
            ]}
          >
            {statusLabel}
          </Text>
        </View>
      </View>

      {error ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recipient</Text>
        <View style={styles.card}>
          <InfoRow label="Name" value={details.recipient.name} colors={colors} />
          <InfoRow label="Recipient ID" value={details.recipient.id} colors={colors} />
          <InfoRow label="Wallet" value={details.recipient.wallet} colors={colors} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Package Details</Text>
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Claim Status</Text>
        <StepProgress status={details.status} colors={colors} />
        <Text style={styles.statusCaption}>
          Current status: {statusLabel}
        </Text>
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        style={[
          styles.button,
          { backgroundColor: colors.brand.primary },
          refreshing ? styles.buttonDisabled : null,
        ]}
        onPress={() => loadDetails(true)}
        disabled={refreshing}
        activeOpacity={0.8}
      >
        {refreshing ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Refresh Status</Text>
        )}
      </TouchableOpacity>

      {lastUpdated ? (
        <Text style={styles.lastUpdated}>Last updated {formatDateTime(lastUpdated)}</Text>
      ) : null}
    </ScrollView>
  );
};

const InfoRow = ({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: AppColors;
}) => (
  <View style={stylesShared.infoRow}>
    <Text style={[stylesShared.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
    <Text style={[stylesShared.infoValue, { color: colors.textPrimary }]}>{value}</Text>
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
    <View style={stylesShared.progressWrapper}>
      {steps.map((step, index) => {
        const isComplete = index <= activeIndex;
        const isLast = index === steps.length - 1;
        return (
          <View key={step.key} style={stylesShared.progressItem}>
            <View
              style={[
                stylesShared.progressCircle,
                {
                  backgroundColor: isComplete ? colors.brand.primary : colors.surface,
                  borderColor: isComplete ? colors.brand.primary : colors.border,
                },
              ]}
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
            <Text style={[stylesShared.progressLabel, { color: colors.textSecondary }]}>
              {step.label}
            </Text>
            {!isLast ? (
              <View
                style={[
                  stylesShared.progressLine,
                  { backgroundColor: isComplete ? colors.brand.primary : colors.border },
                ]}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

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
    button: {
      paddingVertical: 14,
      paddingHorizontal: 32,
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
    lastUpdated: {
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 4,
    },
  });
