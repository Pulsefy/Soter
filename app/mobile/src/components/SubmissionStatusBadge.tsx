import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SyncActionState } from '../services/syncQueue';

interface Props {
  state: SyncActionState;
  onRetry?: () => void;
}

const CONFIG: Record<
  SyncActionState,
  { label: string; icon: string; bg: string; fg: string }
> = {
  pending:   { label: 'Queued',    icon: 'clock-outline',        bg: '#FEF3C7', fg: '#92400E' },
  retrying:  { label: 'Retrying',  icon: 'refresh',              bg: '#DBEAFE', fg: '#1E40AF' },
  submitted: { label: 'Submitted', icon: 'check-circle-outline', bg: '#D1FAE5', fg: '#065F46' },
  failed:    { label: 'Failed',    icon: 'alert-circle-outline', bg: '#FEE2E2', fg: '#991B1B' },
};

export const SubmissionStatusBadge: React.FC<Props> = ({ state, onRetry }) => {
  const { label, icon, bg, fg } = CONFIG[state] ?? CONFIG.pending;
  const isSpinning = state === 'retrying';

  return (
    <View style={[styles.badge, { backgroundColor: bg }]} testID="submission-status-badge">
      {isSpinning ? (
        <ActivityIndicator size={14} color={fg} testID="badge-spinner" />
      ) : (
        <MaterialCommunityIcons name={icon as any} size={14} color={fg} />
      )}
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
      {state === 'failed' && onRetry && (
        <TouchableOpacity
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry submission"
          testID="badge-retry-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
