import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';
import { ClaimReceipt, ClaimReceiptData } from '../components/ClaimReceipt';

type Props = NativeStackScreenProps<RootStackParamList, 'ClaimReceipt'>;

export const ClaimReceiptScreen: React.FC<Props> = ({ route, navigation }) => {
  const { claimId } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [claim, setClaim] = useState<ClaimReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mock data - replace with actual API call
  const loadClaim = useCallback(async () => {
    setLoading(true);
    try {
      // TODO: Replace with actual API call
      // const response = await fetch(`/api/claims/${claimId}/receipt`);
      // const data = await response.json();

      // Mock data
      const mockClaim: ClaimReceiptData = {
        claimId,
        packageId: 'pkg-' + Math.random().toString(36).substr(2, 9),
        status: 'disbursed',
        amount: 150.5,
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        timestamp: new Date().toISOString(),
      };

      setClaim(mockClaim);
      setError(null);
    } catch (err) {
      setError('Failed to load claim receipt');
      console.error('Load claim error:', err);
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => {
    void loadClaim();
  }, [loadClaim]);

  const handleClose = () => {
    navigation.goBack();
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
        <Text style={styles.loadingText}>Loading receipt…</Text>
      </View>
    );
  }

  if (error || !claim) {
    return (
      <View style={[styles.container, styles.centered]}>
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={48}
          color={colors.brand.error}
          style={{ marginBottom: 16 }}
        />
        <Text style={styles.errorTitle}>Error Loading Receipt</Text>
        <Text style={styles.errorMessage}>{error || 'Unknown error'}</Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.brand.primary }]}
          onPress={handleClose}
        >
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
          <View style={styles.helpItem}>
            <MaterialCommunityIcons
              name="download"
              size={20}
              color={colors.brand.primary}
            />
            <View style={styles.helpText}>
              <Text style={styles.helpItemTitle}>Save</Text>
              <Text style={styles.helpItemDescription}>
                Download the receipt as a text file to your device
              </Text>
            </View>
          </View>
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
      paddingBottom: 100, // Space for button
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
      color: colors.brand.error,
      marginBottom: 8,
    },
    errorMessage: {
      fontSize: 14,
      color: colors.text,
      marginBottom: 20,
      textAlign: 'center',
    },
    receiptContainer: {
      marginBottom: 24,
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
      marginTop: 16,
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
