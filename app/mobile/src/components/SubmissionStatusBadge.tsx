import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SyncActionState } from '../services/syncQueue';
import { useAppTheme } from '../theme/useAppTheme';

interface Props {
  state: SyncActionState;
  onRetry?: () => void;
}

export const SubmissionStatusBadge: React.FC<Props> = ({ state, onRetry }) => {
  const { colors } = useAppTheme();

  // Mapping theme colors to states dynamically since they depend on useAppTheme hook
  const appColors: any = colors;

  const CONFIG: Record<
    SyncActionState,
    { label: string; icon: string; bg: string; fg: string }
  > = {
    pending:   { label: 'Queued',    icon: 'clock-outline',        bg: appColors.warningBg || '#FEF3C7', fg: appColors.warning || '#92400E' },
    retrying:  { label: 'Retrying',  icon: 'refresh',              bg: appColors.infoBg || '#DBEAFE', fg: appColors.info || '#1E40AF' },
    submitted: { label: 'Submitted', icon: 'check-circle-outline', bg: appColors.successBg || '#D1FAE5', fg: appColors.success || '#065F46' },
    failed:    { label: 'Failed',    icon: 'alert-circle-outline', bg: appColors.errorBg || '#FEE2E2', fg: appColors.error || '#991B1B' },
    conflict:  { label: 'Conflict',  icon: 'alert-decagram-outline', bg: '#F3E8FF', fg: '#6B21A8' },
  };

  const { label, icon, bg, fg } = CONFIG[state] ?? CONFIG.pending;
  const isSpinning = state === 'retrying';

  return (
    <View style={[styles.badge, { backgroundColor: bg }]} testID="submission-status-badge" accessible={true} accessibilityLabel={`Submission status: ${label}`}>
      {isSpinning ? (
        <ActivityIndicator size={14} color={fg} testID="badge-spinner" />
      ) : (
        <MaterialCommunityIcons name={icon as any} size={14} color={fg} />
      )}
      <Text style={[styles.label, { color: fg }]} maxFontSizeMultiplier={2}>{label}</Text>
      {(state === 'failed' || state === 'retrying' || state === 'conflict') && onRetry && (
        <TouchableOpacity
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry submission"
          testID="badge-retry-button"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialCommunityIcons name="refresh" size={14} color={fg} />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
