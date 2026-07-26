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
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';
import { ClaimReceipt, ClaimReceiptData } from '../components/ClaimReceipt';
import { config } from '../config';

type Props = NativeStackScreenProps<RootStackParamList, 'ClaimReceipt'>;

const PENDING_STATUSES: ClaimReceiptData['status'][] = [
  'requested',
  'verified',
  'approved',
];

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: ClaimReceiptData };

export const ClaimReceiptScreen: React.FC<Props> = ({ route, navigation }) => {
  const { claimId } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const loadClaim = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const response = await fetch(
        `${config.apiUrl}/claims/${encodeURIComponent(claimId)}/receipt`,
      );

      if (response.status === 404) {
        setState({ kind: 'not-found' });
        return;
      }

      if (!response.ok) {
        let msg = `Server responded with ${response.status}`;
        try {
          const body = (await response.json()) as
            | { message?: string; error?: string }
            | undefined;
          if (body?.message) msg = body.message;
          else if (body?.error) msg = body.error;
        } catch {
          /* ignore parse errors */
        }
        setState({ kind: 'error', message: msg });
        return;
      }

      const data = (await response.json()) as ClaimReceiptData;
      setState({ kind: 'ready', data });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load claim receipt';
      setState({ kind: 'error', message });
    }
  }, [claimId]);

  useEffect(() => {
    void loadClaim();
  }, [loadClaim]);

  const handleClose = () => {
    navigation.goBack();
  };

  if (state.kind === 'loading') {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
        <Text style={styles.loadingText}>Loading receipt…</Text>
      </View>
    );
  }

  if (state.kind === 'not-found') {
    return (
      <View style={[styles.container, styles.centered]}>
        <MaterialCommunityIcons
          name="file-question-outline"
          size={48}
          color={colors.brand.warning}
          style={{ marginBottom: 16 }}
        />
        <Text style={styles.errorTitle}>Receipt not found</Text>
        <Text style={styles.errorMessage}>
          We could not find a receipt for this claim. The link may be incorrect
          or the claim may have been removed.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.brand.primary }]}
          onPress={handleClose}
        >
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={[styles.container, styles.centered]}>
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={48}
          color={colors.brand.error}
          style={{ marginBottom: 16 }}
        />
        <Text style={styles.errorTitle}>Unable to load receipt</Text>
        <Text style={styles.errorMessage}>{state.message}</Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.brand.primary }]}
          onPress={handleClose}
        >
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const claim = state.data;
  const isPending = PENDING_STATUSES.includes(claim.status);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <MaterialCommunityIcons
            name="receipt-text-check"
            size={32}
            color={colors.brand.primary}
            style={{ marginBottom: 8 }}
          />
          <Text style={styles.headerTitle}>Claim Receipt</Text>
          <Text style={styles.headerSubtitle}>
            Your proof of claim completion
          </Text>
        </View>

        {/* Pending callout */}
        {isPending && (
          <View style={styles.pendingCallout}>
            <MaterialCommunityIcons
              name="clock-outline"
              size={20}
              color={colors.brand.warning}
              style={{ marginRight: 8 }}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.pendingTitle,
                  { color: colors.brand.warning },
                ]}
              >
                Claim is {claim.status}
              </Text>
              <Text style={styles.pendingDescription}>
                This claim has not been disbursed yet. A transaction link will
                appear here once the on-chain disbursement is finalized.
              </Text>
            </View>
          </View>
        )}

        {/* Receipt Card */}
        <View style={styles.receiptContainer}>
          <ClaimReceipt claim={claim} colors={colors} />
        </View>

        {/* Help Section */}
        <View style={styles.helpSection}>
          <Text style={styles.helpTitle}>How to use this receipt:</Text>
          <View style={styles.helpItem}>
            <MaterialCommunityIcons
              name="share-variant"
              size={20}
              color={colors.brand.primary}
            />
            <View style={styles.helpText}>
              <Text style={styles.helpItemTitle}>Share</Text>
              <Text style={styles.helpItemDescription}>
                Send this receipt to others using the native share sheet
              </Text>
            </View>
          </View>
          <View style={styles.helpItem}>
            <MaterialCommunityIcons
              name="content-copy"
              size={20}
              color={colors.brand.primary}
            />
            <View style={styles.helpText}>
              <Text style={styles.helpItemTitle}>Copy</Text>
              <Text style={styles.helpItemDescription}>
                Copy the receipt text to clipboard for pasting elsewhere
              </Text>
            </View>
          </View>
          {claim.explorerLink && (
            <View style={styles.helpItem}>
              <MaterialCommunityIcons
                name="open-in-new"
                size={20}
                color={colors.brand.primary}
              />
              <View style={styles.helpText}>
                <Text style={styles.helpItemTitle}>Verify on-chain</Text>
                <Text style={styles.helpItemDescription}>
                  Open the blockchain explorer to verify the transaction
                  independently
                </Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Close Button */}
      <TouchableOpacity
        style={[styles.closeButton, { backgroundColor: colors.brand.primary }]}
        onPress={handleClose}
      >
        <Text style={styles.closeButtonText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
};

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 16,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      paddingVertical: 20,
      paddingHorizontal: 16,
      paddingBottom: 100,
    },
    header: {
      alignItems: 'center',
      marginBottom: 24,
      paddingTop: 8,
    },
    headerTitle: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    headerSubtitle: {
      fontSize: 14,
      color: colors.text,
      opacity: 0.6,
    },
    loadingText: {
      fontSize: 16,
      color: colors.text,
      marginTop: 12,
    },
    errorTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 8,
    },
    errorMessage: {
      fontSize: 14,
      color: colors.text,
      opacity: 0.7,
      marginBottom: 20,
      textAlign: 'center',
    },
    receiptContainer: {
      marginBottom: 24,
    },
    pendingCallout: {
      flexDirection: 'row',
      backgroundColor: '#fffbeb',
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#fde68a',
      marginBottom: 16,
      alignItems: 'flex-start',
    },
    pendingTitle: {
      fontSize: 13,
      fontWeight: '700',
      marginBottom: 2,
    },
    pendingDescription: {
      fontSize: 12,
      color: '#92400e',
    },
    button: {
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 8,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
      textAlign: 'center',
    },
    closeButton: {
      position: 'absolute',
      bottom: 16,
      left: 16,
      right: 16,
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
    },
    closeButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    helpSection: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 8,
    },
    helpTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 12,
    },
    helpItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      marginBottom: 12,
    },
    helpText: {
      flex: 1,
    },
    helpItemTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 2,
    },
    helpItemDescription: {
      fontSize: 12,
      color: colors.text,
      opacity: 0.6,
    },
  });
