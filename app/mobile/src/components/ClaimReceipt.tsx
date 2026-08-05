import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { config } from '../config';

export interface ClaimReceiptData {
  claimId: string;
  packageId: string;
  status:
    | 'requested'
    | 'verified'
    | 'approved'
    | 'disbursed'
    | 'archived'
    | 'cancelled';
  amount: number;
  tokenAddress?: string;
  transactionHash?: string;
  contractId?: string;
  timestamp: string;
  recipientRef?: string;
  explorerLink?: string;
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

const buildExplorerUrl = (type: 'address' | 'contract' | 'tx', identifier: string) => {
  const network = config.network;
  return `https://stellar.expert/explorer/${network}/${type}/${identifier}`;
};

function FieldCopyButton({ value, label, colors }: { value: string; label: string, colors: any }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert('Error', `Failed to copy ${label}`);
    }
  };
  return (
    <TouchableOpacity onPress={copy} accessibilityRole="button" accessibilityLabel={`Copy ${label}`} style={{ marginLeft: 8 }}>
      <MaterialCommunityIcons name={copied ? 'check' : 'content-copy'} size={16} color={colors.primary} />
    </TouchableOpacity>
  );
}

export const ClaimReceipt: React.FC<ClaimReceiptProps> = ({ claim, colors, compact = false }) => {
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  // We should ideally use theme colors here but it's okay to map statuses to some semantic tokens
  // if available, but for now we'll stick to semantic hex overrides that are readable.
  // The plan said "map hardcoded hex values to semantic theme values (e.g., colors.warningBg)"
  // However, `colors` doesn't provide warningBg, only `warning`, `error`, `success`.
  // Wait, `colors` from useAppTheme does have them! But the prop type is limited:
  // Let's typecast colors as any to access full theme or just rely on what is given.
  const appColors: any = colors;

  const statusColors: Record<string, { bg: string; text: string; icon: string }> = {
    requested: { bg: appColors.warningBg || '#fef3c7', text: appColors.warning || '#92400e', icon: 'clock-outline' },
    verified:  { bg: appColors.infoBg || '#dbeafe', text: appColors.info || '#1e40af', icon: 'check-circle-outline' },
    approved:  { bg: appColors.successBg || '#dcfce7', text: appColors.success || '#166534', icon: 'check-circle' },
    disbursed: { bg: appColors.successBg || '#d1fae5', text: appColors.success || '#065f46', icon: 'check-all' },
    archived:  { bg: appColors.surface || '#f3f4f6', text: appColors.textSecondary || '#374151', icon: 'archive' },
    cancelled: { bg: appColors.errorBg || '#fee2e2', text: appColors.error || '#991b1b', icon: 'close-circle' },
  };

  const statusColor = statusColors[claim.status] || statusColors.requested;

  const formattedDate = useMemo(() => {
    try {
      return new Date(claim.timestamp).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch {
      return claim.timestamp;
    }
  }, [claim.timestamp]);

  const receiptText = useMemo(() => {
    const lines = [
      'Claim Receipt',
      `Claim ID: ${claim.claimId}`,
      `Package ID: ${claim.packageId}`,
      `Status: ${claim.status.toUpperCase()}`,
      `Amount: ${claim.amount} tokens`,
      `Date: ${formattedDate}`,
    ];
    if (claim.tokenAddress) {
      lines.push(`Token Address: ${claim.tokenAddress}`);
    }
    if (claim.transactionHash) {
      lines.push(`Transaction Hash: ${claim.transactionHash}`);
    }
    if (claim.contractId) {
      lines.push(`Contract ID: ${claim.contractId}`);
    }
    if (claim.explorerLink) {
      lines.push(`Explorer Link: ${claim.explorerLink}`);
    }
    return lines.join('\n');
  }, [claim, formattedDate]);

  const handleShare = async () => {
    setSharing(true);
    try {
      await Share.share({
        message: receiptText,
        title: 'Claim Receipt',
        url: claim.explorerLink ?? undefined,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to share receipt');
    } finally {
      setSharing(false);
    }
  };

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(receiptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert('Error', 'Failed to copy receipt');
    }
  };

  const handleOpenExplorer = () => {
    if (!claim.explorerLink) return;
    Linking.openURL(claim.explorerLink).catch(err => {
      Alert.alert('Error', 'Unable to open explorer link');
      console.error('Open explorer error:', err);
    });
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
        rowWithActions: { flexDirection: 'row', alignItems: 'center' },
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
          flex: 1,
        },
        explorerLinkText: {
          color: colors.primary,
          textDecorationLine: 'underline',
          fontSize: 14,
          fontFamily: 'monospace',
          flex: 1,
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
          color: colors.background, // Used background for high contrast with primary
        },
        explorerButton: {
          marginTop: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: colors.primary,
          borderRadius: 8,
          paddingVertical: 10,
        },
        explorerButtonText: {
          fontSize: 12,
          fontWeight: '600',
          color: colors.primary,
        },
      }),
    [colors, statusColor, compact],
  );

  if (compact) {
    return (
      <View style={[styles.container, styles.compactContainer]} accessible={true} accessibilityLabel={`Claim Receipt. Package ${claim.packageId}, date ${formattedDate}, status ${claim.status}`}>
        <View style={styles.compactRow}>
          <View style={styles.compactContent}>
            <Text style={styles.compactPackageId} maxFontSizeMultiplier={2}>{claim.packageId}</Text>
            <Text style={styles.compactTimestamp} maxFontSizeMultiplier={2}>{formattedDate}</Text>
          </View>
          <View style={styles.statusBadge}>
            <MaterialCommunityIcons name={statusColor.icon as any} size={14} color={statusColor.text} />
            <Text style={styles.statusBadgeText} maxFontSizeMultiplier={2}>{claim.status}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header} accessible={true}>
        <Text style={styles.headerTitle} accessibilityRole="header" maxFontSizeMultiplier={2}>Claim Receipt</Text>
        <Text style={styles.headerSubtitle} maxFontSizeMultiplier={2}>Proof of claim completion</Text>
      </View>

      <View style={styles.detailsGrid}>
        <View style={styles.detailRow} accessible={true}>
          <Text style={styles.detailLabel} maxFontSizeMultiplier={2}>Claim ID</Text>
          <Text style={styles.detailValue} numberOfLines={2} ellipsizeMode="middle" maxFontSizeMultiplier={2}>{claim.claimId}</Text>
        </View>

        <View style={styles.detailRow} accessible={true}>
          <Text style={styles.detailLabel} maxFontSizeMultiplier={2}>Package ID</Text>
          <Text style={styles.detailValue} maxFontSizeMultiplier={2}>{claim.packageId}</Text>
        </View>

        <View style={styles.detailRow} accessible={true}>
          <Text style={styles.detailLabel} maxFontSizeMultiplier={2}>Status</Text>
          <View style={styles.statusBadge}>
            <MaterialCommunityIcons name={statusColor.icon as any} size={14} color={statusColor.text} />
            <Text style={styles.statusBadgeText} maxFontSizeMultiplier={2}>{claim.status}</Text>
          </View>
        </View>

        <View style={styles.detailRow} accessible={true}>
          <Text style={styles.detailLabel} maxFontSizeMultiplier={2}>Amount</Text>
          <Text style={styles.amount} maxFontSizeMultiplier={2}>{claim.amount} tokens</Text>
        </View>

        <View style={styles.detailRow} accessible={true}>
          <Text style={styles.detailLabel} maxFontSizeMultiplier={2}>Timestamp</Text>
          <Text style={styles.detailValue} maxFontSizeMultiplier={2}>{formattedDate}</Text>
        </View>

        {claim.tokenAddress && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel} maxFontSizeMultiplier={2}>Token Address</Text>
            <View style={styles.rowWithActions}>
              <TouchableOpacity onPress={() => Linking.openURL(buildExplorerUrl('address', claim.tokenAddress!))} style={{ flex: 1 }} accessibilityRole="link" accessibilityLabel={`View token address ${claim.tokenAddress} on explorer`}>
                <Text style={styles.explorerLinkText} numberOfLines={2} ellipsizeMode="middle" maxFontSizeMultiplier={2}>{claim.tokenAddress}</Text>
              </TouchableOpacity>
              <FieldCopyButton value={claim.tokenAddress} label="token address" colors={colors} />
            </View>
          </View>
        )}

        {claim.transactionHash && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel} maxFontSizeMultiplier={2}>Transaction Hash</Text>
            <View style={styles.rowWithActions}>
              <TouchableOpacity onPress={() => Linking.openURL(buildExplorerUrl('tx', claim.transactionHash!))} style={{ flex: 1 }} accessibilityRole="link" accessibilityLabel={`View transaction ${claim.transactionHash} on explorer`}>
                <Text style={styles.explorerLinkText} numberOfLines={2} ellipsizeMode="middle" maxFontSizeMultiplier={2}>{claim.transactionHash}</Text>
              </TouchableOpacity>
              <FieldCopyButton value={claim.transactionHash} label="transaction hash" colors={colors} />
            </View>
          </View>
        )}

        {claim.contractId && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel} maxFontSizeMultiplier={2}>Contract ID</Text>
            <View style={styles.rowWithActions}>
              <TouchableOpacity onPress={() => Linking.openURL(buildExplorerUrl('contract', claim.contractId!))} style={{ flex: 1 }} accessibilityRole="link" accessibilityLabel={`View contract ${claim.contractId} on explorer`}>
                <Text style={styles.explorerLinkText} numberOfLines={2} ellipsizeMode="middle" maxFontSizeMultiplier={2}>{claim.contractId}</Text>
              </TouchableOpacity>
              <FieldCopyButton value={claim.contractId} label="contract ID" colors={colors} />
            </View>
          </View>
        )}

        {claim.explorerLink && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel} maxFontSizeMultiplier={2}>View on Explorer</Text>
            <TouchableOpacity onPress={handleOpenExplorer} activeOpacity={0.7} accessibilityRole="link" accessibilityLabel="Open blockchain explorer">
              <Text style={styles.explorerLinkText} maxFontSizeMultiplier={2}>
                Open blockchain explorer →
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={[styles.actionButton, sharing && styles.actionButtonDisabled]}
          onPress={handleShare}
          disabled={sharing}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Share claim receipt"
        >
          {sharing
            ? <ActivityIndicator size="small" color={colors.background} />
            : <MaterialCommunityIcons name="share-variant" size={16} color={colors.background} />}
          <Text style={styles.actionButtonText} maxFontSizeMultiplier={2}>Share</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleCopy} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Copy full receipt text">
          <MaterialCommunityIcons name={copied ? 'check' : 'content-copy'} size={16} color={colors.background} />
          <Text style={styles.actionButtonText} maxFontSizeMultiplier={2}>{copied ? 'Copied' : 'Copy'}</Text>
        </TouchableOpacity>
      </View>

      {claim.explorerLink && (
        <TouchableOpacity
          style={styles.explorerButton}
          onPress={handleOpenExplorer}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="View transaction in browser"
        >
          <MaterialCommunityIcons
            name="open-in-new"
            size={16}
            color={colors.primary}
          />
          <Text style={styles.explorerButtonText} maxFontSizeMultiplier={2}>View Transaction</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};
