import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';
import { AidDetails, fetchAidDetails, getMockAidDetails } from '../services/aidApi';
import { useSync } from '../contexts/SyncContext';

type Props = NativeStackScreenProps<RootStackParamList, 'BulkScanSession'>;

type SessionTotals = {
  scanned: number;
  verified: number;
  failed: number;
  skipped: number;
};

type SessionBanner =
  | { tone: 'success' | 'error' | 'info'; text: string }
  | null;

export const BulkScanSessionScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { queueClaimConfirmation, isConnected } = useSync();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanLocked, setScanLocked] = useState(false);
  const [aidId, setAidId] = useState<string | null>(null);
  const [details, setDetails] = useState<AidDetails | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [banner, setBanner] = useState<SessionBanner>(null);
  const [totals, setTotals] = useState<SessionTotals>({
    scanned: 0,
    verified: 0,
    failed: 0,
    skipped: 0,
  });

  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }, []);

  const resetForNextScan = useCallback(() => {
    clearResetTimer();
    setBanner(null);
    setAidId(null);
    setDetails(null);
    setLookupError(null);
    setLookupState('idle');
    setScanLocked(false);
  }, [clearResetTimer]);

  useEffect(() => {
    const getBarCodeScannerPermissions = async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    };

    getBarCodeScannerPermissions();
  }, []);

  useEffect(() => {
    return () => clearResetTimer();
  }, [clearResetTimer]);

  const parseAidIdFromQr = (data: string) => {
    const regex = /^soter:\/\/package\/(.+)$/;
    const match = data.match(regex);
    return match?.[1] ?? null;
  };

  const loadDetails = useCallback(async (nextAidId: string) => {
    setLookupState('loading');
    setLookupError(null);
    setDetails(null);

    try {
      const data = await fetchAidDetails(nextAidId);
      setDetails(data);
      setLookupState('ready');
    } catch {
      setLookupError('Unable to reach the server. Showing last known data.');
      setDetails(getMockAidDetails(nextAidId));
      setLookupState('error');
    }
  }, []);

  const handleBarCodeScanned = useCallback(
    ({ data }: { type: string; data: string }) => {
      if (scanLocked) return;

      setScanLocked(true);
      setBanner(null);

      const nextAidId = parseAidIdFromQr(data);

      if (!nextAidId) {
        setTotals((prev) => ({ ...prev, failed: prev.failed + 1 }));
        setBanner({
          tone: 'error',
          text: 'Invalid QR code. Scan a Soter package QR to continue.',
        });
        clearResetTimer();
        resetTimer.current = setTimeout(() => resetForNextScan(), 1400);
        return;
      }

      setTotals((prev) => ({ ...prev, scanned: prev.scanned + 1 }));
      setAidId(nextAidId);
      void loadDetails(nextAidId);
    },
    [clearResetTimer, loadDetails, resetForNextScan, scanLocked],
  );

  const scheduleAutoReset = useCallback(() => {
    clearResetTimer();
    resetTimer.current = setTimeout(() => resetForNextScan(), 900);
  }, [clearResetTimer, resetForNextScan]);

  const handleSkip = useCallback(() => {
    setTotals((prev) => ({ ...prev, skipped: prev.skipped + 1 }));
    setBanner({ tone: 'info', text: 'Skipped. Ready for next scan.' });
    scheduleAutoReset();
  }, [scheduleAutoReset]);

  const handleRetryLookup = useCallback(() => {
    if (!aidId) return;
    void loadDetails(aidId);
  }, [aidId, loadDetails]);

  const handleVerify = useCallback(async () => {
    if (!aidId || !details) return;

    setLookupState('loading');
    setBanner(null);

    try {
      const result = await queueClaimConfirmation(aidId, details.claimId);
      setTotals((prev) => ({ ...prev, verified: prev.verified + 1 }));

      if (result.status === 'completed') {
        setBanner({ tone: 'success', text: 'Verified. Ready for next scan.' });
      } else {
        setBanner({
          tone: 'info',
          text: isConnected
            ? 'Verification queued. We will retry automatically.'
            : 'Saved offline. It will sync when connectivity returns.',
        });
      }

      scheduleAutoReset();
    } catch (error) {
      setTotals((prev) => ({ ...prev, failed: prev.failed + 1 }));
      setLookupState('ready');
      setBanner({ tone: 'error', text: 'Verification failed. Try again or skip.' });

      const message =
        error instanceof Error ? error.message : 'Unexpected verification error';
      console.log('Bulk scan verify error:', message);
    }
  }, [aidId, details, isConnected, queueClaimConfirmation, scheduleAutoReset]);

  // ── Permission: requesting ───────────────────────────────────────────────
  if (hasPermission === null) {
    return (
      <View
        style={styles.centered}
        accessible
        accessibilityLabel="Requesting camera permission to scan QR codes"
        accessibilityLiveRegion="polite"
      >
        <Text style={styles.centeredText}>Requesting camera permission…</Text>
      </View>
    );
  }

  // ── Permission: denied ───────────────────────────────────────────────────
  if (hasPermission === false) {
    return (
      <View
        style={styles.centered}
        accessible
        accessibilityLabel="Camera access denied. Cannot scan QR codes."
      >
        <Text style={[styles.centeredText, { marginBottom: 16 }]}>
          No access to camera
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.primaryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BarCodeScanner
        onBarCodeScanned={scanLocked ? undefined : handleBarCodeScanned}
        style={StyleSheet.absoluteFillObject}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <View
            style={styles.totalsPill}
            accessible
            accessibilityLabel={`Session totals. Scanned ${totals.scanned}. Verified ${totals.verified}. Failed ${totals.failed}. Skipped ${totals.skipped}.`}
          >
            <Text style={styles.totalsText}>
              Scanned {totals.scanned} · Verified {totals.verified} · Failed {totals.failed} · Skipped {totals.skipped}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.endSessionButton}
            accessibilityRole="button"
            accessibilityLabel="End session"
            accessibilityHint="Stops bulk scan session mode and returns to the previous screen"
            onPress={() => {
              if (totals.scanned + totals.verified + totals.failed + totals.skipped === 0) {
                navigation.goBack();
                return;
              }
              Alert.alert(
                'End Session?',
                'Session totals will be cleared.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'End Session', style: 'destructive', onPress: () => navigation.goBack() },
                ],
              );
            }}
          >
            <Text style={styles.endSessionText}>End</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.focusArea} pointerEvents="none" accessibilityElementsHidden />

        {banner ? (
          <View
            style={[
              styles.banner,
              banner.tone === 'success'
                ? styles.bannerSuccess
                : banner.tone === 'error'
                  ? styles.bannerError
                  : styles.bannerInfo,
            ]}
            accessible
            accessibilityLabel={banner.text}
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.bannerText}>{banner.text}</Text>
          </View>
        ) : null}

        <View style={styles.bottomCard}>
          {!scanLocked ? (
            <Text style={styles.helpText} accessibilityLiveRegion="polite">
              Align a Soter package QR within the frame.
            </Text>
          ) : null}

          {scanLocked && aidId && (
            <View style={styles.resultCard} accessible accessibilityLabel={`Scanned package ${aidId}`}>
              <Text style={styles.resultTitle}>Package {aidId}</Text>

              {lookupState === 'loading' ? (
                <View style={styles.inlineLoading}>
                  <ActivityIndicator size="small" color={colors.brand.primary} accessibilityElementsHidden />
                  <Text style={styles.inlineLoadingText}>Loading…</Text>
                </View>
              ) : null}

              {lookupError ? (
                <Text style={styles.resultMeta} accessibilityRole="alert">
                  {lookupError}
                </Text>
              ) : null}

              {details ? (
                <View style={styles.detailRows}>
                  <Text style={styles.resultMeta}>Recipient: {details.recipient.name}</Text>
                  <Text style={styles.resultMeta}>Status: {details.status}</Text>
                </View>
              ) : null}

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Skip package"
                  accessibilityHint="Marks this package as skipped and moves to the next scan"
                  onPress={handleSkip}
                >
                  <Text style={styles.secondaryButtonText}>Skip</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    lookupState === 'loading' || !details ? styles.buttonDisabled : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Verify package"
                  accessibilityHint="Submits verification for this package and moves to the next scan"
                  accessibilityState={{ disabled: lookupState === 'loading' || !details }}
                  onPress={handleVerify}
                  disabled={lookupState === 'loading' || !details}
                >
                  <Text style={styles.primaryButtonText}>Verify</Text>
                </TouchableOpacity>
              </View>

              {lookupState === 'error' ? (
                <TouchableOpacity
                  style={styles.tertiaryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Retry lookup"
                  accessibilityHint="Tries fetching package details again"
                  onPress={handleRetryLookup}
                >
                  <Text style={styles.tertiaryButtonText}>Retry lookup</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {scanLocked && !aidId ? (
            <TouchableOpacity
              style={styles.primaryButton}
              accessibilityRole="button"
              accessibilityLabel="Scan again"
              accessibilityHint="Resets the scanner so you can scan another QR code"
              onPress={resetForNextScan}
            >
              <Text style={styles.primaryButtonText}>Scan Again</Text>
            </TouchableOpacity>
          ) : null}

          {scanLocked && aidId ? (
            <TouchableOpacity
              style={styles.tertiaryButton}
              accessibilityRole="button"
              accessibilityLabel="Next scan"
              accessibilityHint="Skips any remaining actions and returns to scanning"
              onPress={resetForNextScan}
            >
              <Text style={styles.tertiaryButtonText}>Next Scan</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#000000',
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'space-between',
      paddingTop: 18,
      paddingBottom: 18,
      paddingHorizontal: 16,
    },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    totalsPill: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.65)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
    },
    totalsText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '700',
      textAlign: 'center',
    },
    endSessionButton: {
      minWidth: 44,
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: 999,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.65)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
    },
    endSessionText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '800',
    },
    focusArea: {
      alignSelf: 'center',
      width: '74%',
      aspectRatio: 1,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: colors.brand.primary,
      backgroundColor: 'transparent',
    },
    banner: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      marginTop: 12,
    },
    bannerSuccess: {
      backgroundColor: 'rgba(46, 125, 50, 0.25)',
      borderColor: 'rgba(46, 125, 50, 0.6)',
    },
    bannerError: {
      backgroundColor: 'rgba(198, 40, 40, 0.22)',
      borderColor: 'rgba(198, 40, 40, 0.6)',
    },
    bannerInfo: {
      backgroundColor: 'rgba(21, 101, 192, 0.22)',
      borderColor: 'rgba(21, 101, 192, 0.6)',
    },
    bannerText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
      textAlign: 'center',
    },
    bottomCard: {
      gap: 12,
    },
    helpText: {
      color: '#FFFFFF',
      textAlign: 'center',
      fontSize: 14,
      fontWeight: '700',
      backgroundColor: 'rgba(0,0,0,0.55)',
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
    },
    resultCard: {
      backgroundColor: 'rgba(0,0,0,0.65)',
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
      gap: 10,
    },
    resultTitle: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '900',
      textAlign: 'center',
    },
    resultMeta: {
      color: 'rgba(255,255,255,0.88)',
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    detailRows: {
      gap: 6,
    },
    inlineLoading: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 10,
    },
    inlineLoadingText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },
    actionsRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 6,
    },
    primaryButton: {
      flex: 1,
      minHeight: 44,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: colors.brand.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    primaryButtonText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '800',
    },
    secondaryButton: {
      flex: 1,
      minHeight: 44,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.06)',
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    secondaryButtonText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '800',
    },
    tertiaryButton: {
      minHeight: 44,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
    },
    tertiaryButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '800',
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
      paddingHorizontal: 24,
    },
    centeredText: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'center',
    },
  });
