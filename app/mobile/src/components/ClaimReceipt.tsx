import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  ActivityIndicator,
  Clipboard,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export interface ClaimReceiptData {
  claimId: string;
  packageId: string;
  status: 'requested' | 'verified' | 'approved' | 'disbursed' | 'archived';
  amount: number;
  tokenAddress?: string;
  timestamp: string;
  recipientRef?: string;
}

interface ClaimReceiptProps {
  claim: ClaimReceiptData;
  colors: {
    background: string;
    text: string;
    primary: string;
    card: string;
    border: string;
    success: string;
    warning: string;
    error: string;
  };
  compact?: boolean;
}

const statusColors: Record<
  string,
  { bg: string; text: string; icon: string }
> = {
  requested: { bg: '#fef3c7', text: '#92400e', icon: 'clock-outline' },
  verified: { bg: '#dbeafe', text: '#1e40af', icon: 'check-circle-outline' },
  approved: { bg: '#dcfce7', text: '#166534', icon: 'check-circle' },
  disbursed: { bg: '#d1fae5', text: '#065f46', icon: 'check-all' },
  archived: { bg: '#f3f4f6', text: '#374151', icon: 'archive' },
};

export const ClaimReceipt: React.FC<ClaimReceiptProps> = ({
  claim,
  colors,
  compact = false,
}) => {
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  const statusColor = statusColors[claim.status] || statusColors.requested;

  const formattedDate = useMemo(() => {
    try {
      const date = new Date(claim.timestamp);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return claim.timestamp;
    }
  }, [claim.timestamp]);

  const receiptText = useMemo(() => {
    return `Claim Receipt
Claim ID: ${claim.claimId}
Package ID: ${claim.packageId}
Status: ${claim.status.toUpperCase()}
Amount: ${claim.amount} tokens
Date: ${formattedDate}
${claim.tokenAddress ? `Token Address: ${claim.tokenAddress}` : ''}`;
  }, [claim, formattedDate]);

  const handleShare = async () => {
    setSharing(true);
    try {
      await Share.share({
        message: receiptText,
        title: 'Claim Receipt',
        url: undefined, // Platform-specific; iOS uses this for URLs
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to share receipt');
      console.error('Share error:', error);
    } finally {
      setSharing(false);
    }
  };

  const handleCopy = async () => {
    try {
      await Clipboard.setString(receiptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      Alert.alert('Error', 'Failed to copy receipt');
      console.error('Copy error:', error);
    }
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: colors.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          padding: compact ? 12 : 20,
        },
        compactContainer: {
          backgroundColor: statusColor.bg,
          borderLeftWidth: 4,
          borderLeftColor: statusColor.text,
        },
        header: {
          marginBottom: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        headerTitle: {
          fontSize: 20,
          fontWeight: 'bold',
          color: colors.text,
          marginBottom: 4,
        },
        headerSubtitle: {
          fontSize: 12,
          color: colors.text,
          opacity: 0.6,
        },
        detailsGrid: {
          marginBottom: 16,
        },
        detailRow: {
          marginBottom: 12,
        },
        detailLabel: {
          fontSize: 11,
          fontWeight: '600',
          color: colors.text,
          opacity: 0.6,
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
        detailValue: {
          fontSize: 14,
          color: colors.text,
          fontFamily: 'monospace',
        },
        statusBadge: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: statusColor.bg,
          borderRadius: 8,
          paddingVertical: 4,
          paddingHorizontal: 8,
          alignSelf: 'flex-start',
        },
        statusBadgeText: {
          fontSize: 12,
          fontWeight: '600',
          color: statusColor.text,
          textTransform: 'capitalize',
        },
        amount: {
          fontSize: 16,
          fontWeight: '600',
          color: statusColor.text,
        },
        compactRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        compactContent: {
          flex: 1,
        },
        compactPackageId: {
          fontSize: 14,
          fontWeight: '600',
          color: statusColor.text,
          marginBottom: 2,
        },
        compactTimestamp: {
          fontSize: 11,
          color: statusColor.text,
          opacity: 0.7,
        },
        actionsContainer: {
          flexDirection: 'row',
          gap: 8,
        },
        actionButton: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          backgroundColor: colors.primary,
          borderRadius: 8,
          paddingVertical: 10,
          opacity: 0.9,
        },
        actionButtonDisabled: {
          opacity: 0.5,
        },
        actionButtonText: {
          fontSize: 12,
          fontWeight: '600',
          color: '#fff',
        },
      }),
    [colors, statusColor],
  );

  if (compact) {
    return (
      <View style={[styles.container, styles.compactContainer]}>
        <View style={styles.compactRow}>
          <View style={styles.compactContent}>
            <Text style={styles.compactPackageId}>{claim.packageId}</Text>
            <Text style={styles.compactTimestamp}>{formattedDate}</Text>
          </View>
          <View style={styles.statusBadge}>
            <MaterialCommunityIcons
              name={statusColor.icon as any}
              size={14}
              color={statusColor.text}
            />
            <Text style={styles.statusBadgeText}>{claim.status}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Claim Receipt</Text>
        <Text style={styles.headerSubtitle}>Proof of claim completion</Text>
      </View>

      {/* Details */}
      <View style={styles.detailsGrid}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Claim ID</Text>
          <Text
            style={styles.detailValue}
            numberOfLines={2}
            ellipsizeMode="middle"
          >
            {claim.claimId}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Package ID</Text>
          <Text style={styles.detailValue}>{claim.packageId}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Status</Text>
          <View style={styles.statusBadge}>
            <MaterialCommunityIcons
              name={statusColor.icon as any}
              size={14}
              color={statusColor.text}
            />
            <Text style={styles.statusBadgeText}>{claim.status}</Text>
          </View>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Amount</Text>
          <Text style={styles.amount}>{claim.amount} tokens</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Timestamp</Text>
          <Text style={styles.detailValue}>{formattedDate}</Text>
        </View>

        {claim.tokenAddress && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Token Address</Text>
            <Text
              style={styles.detailValue}
              numberOfLines={2}
              ellipsizeMode="middle"
            >
              {claim.tokenAddress}
            </Text>
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={[styles.actionButton, sharing && styles.actionButtonDisabled]}
          onPress={handleShare}
          disabled={sharing}
          activeOpacity={0.7}
        >
          {sharing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialCommunityIcons name="share-variant" size={16} color="#fff" />
          )}
          <Text style={styles.actionButtonText}>Share</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleCopy}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name={copied ? 'check' : 'content-copy'}
            size={16}
            color="#fff"
          />
          <Text style={styles.actionButtonText}>
            {copied ? 'Copied' : 'Copy'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
