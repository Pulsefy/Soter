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
import { fetchClaimReceipt, ReceiptApiError } from '../services/api';
import { useTranslation } from '../i18n/useTranslation';

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
  const identifier = route.params.packageId ?? route.params.claimId;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const loadClaim = useCallback(async () => {
    if (!identifier) {
      setState({ kind: 'error', message: 'A claim or package identifier is required.' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const data = await fetchClaimReceipt(identifier);
      setState({ kind: 'ready', data });
    } catch (err) {
      if (err instanceof ReceiptApiError && err.status === 404) {
        setState({ kind: 'not-found' });
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Failed to load claim receipt';
      setState({ kind: 'error', message });
    }
  }, [identifier]);

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
        <Text style={styles.loadingText}>{t('claimReceipt.loading')}</Text>
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
        <Text style={styles.errorTitle}>{t('claimReceipt.notFound')}</Text>
        <Text style={styles.errorMessage}>
          We could not find a receipt for this claim. The link may be incorrect
          or the claim may have been removed.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.brand.primary }]}
          onPress={handleClose}
        >
          <Text style={styles.buttonText}>{t('claimReceipt.goBack')}</Text>
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
        <Text style={styles.errorTitle}>{t('claimReceipt.unableToLoad')}</Text>
        <Text style={styles.errorMessage}>{state.message}</Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.brand.primary }]}
          onPress={handleClose}
        >
          <Text style={styles.buttonText}>{t('claimReceipt.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const claim = state.data;
  const isPending = PENDING_STATUSES.includes(claim.status);
  const isFailed = claim.status === 'cancelled';

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
          <Text style={styles.headerTitle}>{t('claimReceipt.title')}</Text>
          <Text style={styles.headerSubtitle}>
            {isFailed ? 'This claim was not completed' : isPending ? 'Your claim is still being processed' : 'Your proof of claim completion'}
          </Text>
        </View>

        {(isPending || isFailed) && (
          <View style={[styles.pendingCallout, isFailed && styles.failedCallout]}>
            <MaterialCommunityIcons
              name={isFailed ? 'close-circle-outline' : 'clock-outline'}
              size={20}
              color={isFailed ? colors.brand.error : colors.brand.warning}
              style={{ marginRight: 8 }}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.pendingTitle,
                  { color: isFailed ? colors.brand.error : colors.brand.warning },
                ]}
              >
                {isFailed ? 'Claim failed' : `Claim is ${claim.status}`}
              </Text>
              <Text style={[styles.pendingDescription, isFailed && styles.failedDescription]}>
                {isFailed
                  ? 'This claim was cancelled and no disbursement was made.'
                  : 'This claim has not been disbursed yet. A transaction link will appear here once the on-chain disbursement is finalized.'}
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
          <Text style={styles.helpTitle}>{t('claimReceipt.howToUse')}</Text>
          <View style={styles.helpItem}>
            <MaterialCommunityIcons
              name="share-variant"
              size={20}
              color={colors.brand.primary}
            />
            <View style={styles.helpText}>
              <Text style={styles.helpItemTitle}>{t('claimReceipt.share')}</Text>
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
              <Text style={styles.helpItemTitle}>{t('claimReceipt.copy')}</Text>
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
                <Text style={styles.helpItemTitle}>{t('claimReceipt.verifyOnChain')}</Text>
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
        <Text style={styles.closeButtonText}>{t('common.done')}</Text>
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
    failedCallout: {
      backgroundColor: '#fef2f2',
      borderColor: '#fecaca',
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
    failedDescription: {
      color: '#991b1b',
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
