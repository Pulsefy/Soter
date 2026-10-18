import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeContext';
import { useTranslation } from '../i18n/useTranslation';
import { useSync } from '../contexts/SyncContext';
import {
  buildEvidenceUploadPayload,
  EvidenceUploadRequest,
} from '../services/verificationApi';
import {
  buildStorageWarningMessage,
  formatBytes,
  getStorageQuotaStatus,
  StorageQuotaStatus,
} from '../services/storageQuota';
import { structuredLogger } from '../services/logger';
import {
  E2E_EVIDENCE_IMAGE_BASE64,
  E2E_EVIDENCE_IMAGE_DATA_URI,
  E2E_SIMULATE_CAPTURE_LABEL,
  isE2ETestModeEnabled,
} from '../e2e/testMode';

type Props = NativeStackScreenProps<RootStackParamList, 'EvidenceUpload'>;

const MAX_IMAGE_WIDTH = 1024;
const JPEG_QUALITY = 0.65;

export const EvidenceUploadScreen: React.FC<Props> = ({
  route,
  navigation,
}) => {
  const { aidId } = route.params;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isConnected, queueEvidenceUpload, getActionsForAid, retryAction } =
    useSync();

  const uploadActions = useMemo(
    () => getActionsForAid(aidId),
    [getActionsForAid, aidId],
  );
  const activeUpload = useMemo(
    () => uploadActions.find(a => a.type === 'evidence-upload'),
    [uploadActions],
  );

  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [compressedBase64, setCompressedBase64] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('evidence.jpg');
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageQuotaStatus | null>(null);

  const openSettings = useCallback(async () => {
    try {
      if (Platform.OS === 'ios') {
        await Linking.openURL('app-settings:');
      } else {
        await Linking.openSettings();
      }
    } catch {
      structuredLogger.warn(
        'evidence_upload.open_settings_failed',
        { platform: Platform.OS },
        'evidenceUpload',
      );
    }
  }, []);

  /**
   * Refresh the device storage snapshot (#1160). The pending-queue term in
   * the service already reflects `uploadActions`, so this stays accurate as
   * uploads complete. A low/critical result keeps a banner visible so the
   * worker sees the risk even after dismissing the pre-capture alert.
   */
  const refreshStorageStatus = useCallback(async () => {
    try {
      const status = await getStorageQuotaStatus();
      setStorageStatus(status);
      return status;
    } catch (quotaError) {
      structuredLogger.warn(
        'evidence_upload.storage_check_failed',
        { error: quotaError instanceof Error ? quotaError.message : String(quotaError) },
        'evidenceUpload',
      );
      return null;
    }
  }, []);

  // Check once when the screen opens so low storage is visible before any
  // capture attempt, and re-check whenever the pending upload set changes.
  useEffect(() => {
    void refreshStorageStatus();
  }, [refreshStorageStatus, uploadActions]);

  /**
   * Storage gate run before starting any capture (#1160).
   *
   * - `ok`: capture proceeds immediately.
   * - `low` / unreadable: warns first; the worker can continue or cancel.
   * - `critical`: capture is blocked until space is freed.
   *
   * The check accounts for pending queued uploads via the storage service,
   * so nearly-full devices are detected even when free space alone looks
   * sufficient.
   */
  const ensureStorageForCapture = useCallback(async (): Promise<boolean> => {
    const status = await refreshStorageStatus();

    // Unreadable storage: show a non-blocking advisory once, then proceed.
    if (!status) {
      return true;
    }

    if (status.level === 'ok') {
      return true;
    }

    const warning = buildStorageWarningMessage(status);
    structuredLogger.warn(
      'evidence_upload.low_storage_warning',
      {
        level: status.level,
        freeDiskBytes: status.freeDiskBytes,
        pendingUploadBytes: status.pendingUploadBytes,
        effectiveFreeBytes: status.effectiveFreeBytes,
      },
      'evidenceUpload',
    );

    if (status.level === 'critical') {
      Alert.alert(
        t('evidence.storageCriticalTitle'),
        warning ?? t('evidence.storageCriticalBody', { free: formatBytes(status.effectiveFreeBytes) }),
        [{ text: t('common.ok') }],
        { cancelable: true },
      );
      return false;
    }

    return new Promise<boolean>((resolve) => {
      Alert.alert(
        t('evidence.storageLowTitle'),
        warning ?? t('evidence.storageLowBody', { free: formatBytes(status.effectiveFreeBytes) }),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
          {
            text: t('evidence.storageContinue'),
            style: 'destructive',
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }, [refreshStorageStatus, t]);

  const compressPhoto = useCallback(async (uri: string) => {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MAX_IMAGE_WIDTH } }],
      {
        compress: JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );

    if (!result.base64) {
      throw new Error('Unable to compress image');
    }

    setSelectedImageUri(result.uri);
    setCompressedBase64(result.base64);
    setFilename(`evidence-${Date.now()}.jpg`);
  }, []);

  /**
   * E2E-only: populate the capture pipeline with a bundled image so the
   * queue/upload steps can be driven on an emulator, where the native
   * camera and photo picker cannot be automated. Gated behind the E2E
   * build switch (`src/e2e/e2eBuildFlag.ts`); never rendered in production
   * (issue #932).
   */
  const useFixtureEvidence = useCallback(() => {
    setSelectedImageUri(E2E_EVIDENCE_IMAGE_DATA_URI);
    setCompressedBase64(E2E_EVIDENCE_IMAGE_BASE64);
    setFilename('e2e-evidence.jpg');
    setStatusMessage(null);
    setError(null);
  }, []);

  const pickImage = useCallback(async () => {
    setStatusMessage(null);
    setError(null);

    // #1160: check device storage (minus pending uploads) before capture.
    if (!(await ensureStorageForCapture())) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission required',
        'Photo library access is required to select evidence.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) {
      return;
    }

    await compressPhoto(result.assets[0].uri);
  }, [compressPhoto, ensureStorageForCapture]);

  const takePhoto = useCallback(async () => {
    setStatusMessage(null);
    setError(null);

    // #1160: check device storage (minus pending uploads) before capture.
    if (!(await ensureStorageForCapture())) {
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      // Check if we can ask again or if it's permanently blocked
      if (!permission.canAskAgain) {
        Alert.alert(
          'Camera Access Blocked',
          'Camera access has been blocked. Please enable it in your device settings to capture evidence photos.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: openSettings },
            { text: 'Use Photo Library', onPress: pickImage },
          ],
        );
      } else {
        Alert.alert(
          'Camera Permission Required',
          'Camera access is needed to capture evidence photos. Would you like to try again or choose from your photo library?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Try Again', onPress: takePhoto },
            { text: 'Use Photo Library', onPress: pickImage },
          ],
        );
      }
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) {
      return;
    }

    await compressPhoto(result.assets[0].uri);
  }, [compressPhoto, ensureStorageForCapture, openSettings, pickImage]);

  const handleUpload = useCallback(async () => {
    if (!compressedBase64) {
      return;
    }

    setUploading(true);
    setError(null);
    setStatusMessage('Preparing evidence for upload…');

    const payload: EvidenceUploadRequest = {
      aidId,
      filename,
      contentType: 'image/jpeg',
      imageBase64: compressedBase64,
      source: 'mobile',
    };

    try {
      const result = await queueEvidenceUpload(
        aidId,
        buildEvidenceUploadPayload(payload),
      );

      if (result.status === 'completed') {
        setStatusMessage('Evidence uploaded successfully.');
      } else {
        setStatusMessage(
          isConnected
            ? 'Upload queued and will retry automatically if the connection is unstable.'
            : 'Upload queued and will send when connectivity returns.',
        );
      }
    } catch (uploadError) {
      setError('Evidence upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [aidId, compressedBase64, filename, isConnected, queueEvidenceUpload]);

  const resetSelection = useCallback(() => {
    setSelectedImageUri(null);
    setCompressedBase64(null);
    setFilename('evidence.jpg');
    setStatusMessage(null);
    setError(null);
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Upload Evidence
        </Text>
        <Text style={styles.subtitle}>
          Capture or select a document or photo to support your verification.
        </Text>
      </View>

      {storageStatus && storageStatus.level !== 'ok' ? (
        <View
          style={[
            styles.storageBanner,
            storageStatus.level === 'critical'
              ? styles.storageBannerCritical
              : styles.storageBannerLow,
          ]}
          accessibilityRole="alert"
          accessibilityLabel={t('evidence.storageBannerA11y')}
          testID="storage-quota-warning"
        >
          <Text style={styles.storageBannerTitle}>
            {storageStatus.level === 'critical'
              ? t('evidence.storageCriticalTitle')
              : t('evidence.storageLowTitle')}
          </Text>
          <Text style={styles.storageBannerText}>
            {t('evidence.storageBannerBody', {
              free: formatBytes(storageStatus.effectiveFreeBytes),
              pending: formatBytes(storageStatus.pendingUploadBytes),
            })}
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('evidence.step1')}</Text>
        <Text style={styles.helpText}>
          Use your camera or photo library to capture a document, receipt, or
          other proof.
        </Text>
        <View style={styles.buttonGroup}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={takePhoto}
            accessibilityRole="button"
            accessibilityLabel="Take a photo of evidence"
            testID="take-photo-button"
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>{t('evidence.takePhoto')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={pickImage}
            accessibilityRole="button"
            accessibilityLabel="Select an evidence photo from your library"
            testID="select-photo-button"
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryButtonText}>{t('evidence.selectPhoto')}</Text>
          </TouchableOpacity>
          {isE2ETestModeEnabled() ? (
            <TouchableOpacity
              style={[styles.button, styles.e2eButton]}
              onPress={useFixtureEvidence}
              accessibilityRole="button"
              accessibilityLabel="E2E simulate evidence capture"
              testID="e2e-simulate-capture"
              activeOpacity={0.8}
            >
              <Text style={styles.e2eButtonText}>{E2E_SIMULATE_CAPTURE_LABEL}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {selectedImageUri ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('evidence.step2')}</Text>
          <Image
            source={{ uri: selectedImageUri }}
            style={styles.previewImage}
          />
          <Text style={styles.previewLabel}>{filename}</Text>
          <View style={styles.buttonGroup}>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={resetSelection}
              accessibilityRole="button"
              accessibilityLabel="Choose a different photo"
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>{t('evidence.chooseAgain')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('evidence.step3')}</Text>
        <Text style={styles.helpText}>
          Compressed image upload saves data on low-bandwidth connections.
        </Text>
        {/*
          The upload outcome is rendered *above* the button, not below it.
          The app draws edge-to-edge, so the tail of a phone-sized form sits
          under the system navigation bar (the same reason the scanner's
          overlay overflows) — copy appended after the button can end up
          behind the bar and be invisible to the user, the accessibility
          tree and the E2E flows. Above the button it shares the space the
          button itself is scrolled into.
        */}
        {statusMessage ? (
          <Text style={styles.statusText}>{statusMessage}</Text>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={handleUpload}
          disabled={!compressedBase64 || uploading || !!activeUpload}
          accessibilityRole="button"
          testID="upload-evidence-button"
          accessibilityLabel={
            uploading ? 'Uploading evidence' : 'Upload evidence now'
          }
          accessibilityState={{
            busy: uploading,
            disabled: !compressedBase64 || uploading || !!activeUpload,
          }}
          activeOpacity={0.8}
        >
          {uploading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>{t('aidDetails.uploadEvidence')}</Text>
          )}
        </TouchableOpacity>
        {activeUpload ? (
          <View style={styles.queueCard}>
            <View style={styles.queueHeader}>
              <Text style={styles.queueTitle}>
                {activeUpload.state === 'failed'
                  ? '⚠️ Upload Failed'
                  : activeUpload.state === 'retrying'
                    ? '🔄 Retrying Upload…'
                    : '📤 Uploading…'}
              </Text>
              <Text style={styles.queueStatus}>
                {activeUpload.state === 'failed'
                  ? 'Unstable connection'
                  : activeUpload.state === 'retrying'
                    ? `Attempt ${activeUpload.retryCount} of ${activeUpload.maxRetries}`
                    : 'Transferring chunks'}
              </Text>
            </View>

            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${Math.round((activeUpload.payload.progress || 0) * 100)}%`,
                    backgroundColor:
                      activeUpload.state === 'failed'
                        ? colors.error
                        : colors.brand.primary,
                  },
                ]}
              />
            </View>

            <View style={styles.progressRow}>
              <Text style={styles.progressText}>
                {Math.round((activeUpload.payload.progress || 0) * 100)}%
                Completed
              </Text>
              {activeUpload.state === 'failed' && (
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => retryAction(activeUpload.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Retry failed upload"
                >
                  <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {activeUpload.lastError ? (
              <Text style={styles.errorDetails}>
                Reason: {activeUpload.lastError}
              </Text>
            ) : null}
          </View>
        ) : null}
        {!isConnected && !activeUpload ? (
          <Text style={styles.offlineNotice}>
            Offline mode: evidence upload will queue and resend when the device
            reconnects.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
};

const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 20,
      // Clears the system navigation bar (48dp on the CI emulator) so the
      // trailing offline notice can be scrolled fully into view instead of
      // ending up behind it.
      paddingBottom: 96,
      gap: 18,
    },
    header: {
      gap: 8,
    },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: 15,
      color: colors.textSecondary,
      lineHeight: 22,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 14,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    helpText: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    buttonGroup: {
      flexDirection: Platform.OS === 'web' ? 'row' : 'column',
      gap: 12,
    },
    button: {
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
    },
    primaryButton: {
      backgroundColor: colors.brand.primary,
    },
    secondaryButton: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.brand.primary,
    },
    buttonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
    },
    secondaryButtonText: {
      color: colors.brand.primary,
      fontSize: 16,
      fontWeight: '700',
    },
    e2eButton: {
      backgroundColor: '#FEF3C7',
      borderWidth: 1,
      borderColor: '#F59E0B',
    },
    e2eButtonText: {
      color: '#92400E',
      fontSize: 15,
      fontWeight: '700',
    },
    previewImage: {
      width: '100%',
      aspectRatio: 4 / 3,
      borderRadius: 12,
      backgroundColor: colors.border,
    },
    previewLabel: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 8,
    },
    statusText: {
      fontSize: 14,
      color: colors.info,
    },
    errorText: {
      fontSize: 14,
      color: colors.error,
    },
    offlineNotice: {
      marginTop: 12,
      fontSize: 13,
      color: colors.textSecondary,
    },
    queueCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginTop: 12,
      gap: 10,
    },
    queueHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    queueTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    queueStatus: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    progressBarBg: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.border,
      overflow: 'hidden',
      width: '100%',
    },
    progressBarFill: {
      height: '100%',
      borderRadius: 4,
    },
    progressRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    progressText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    retryButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.brand.primary,
    },
    retryButtonText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },
    errorDetails: {
      fontSize: 12,
      color: colors.error,
      marginTop: 4,
      lineHeight: 16,
    },
    storageBanner: {
      borderRadius: 12,
      borderWidth: 1,
      padding: 14,
      gap: 4,
    },
    storageBannerLow: {
      backgroundColor: '#FEF3C7',
      borderColor: '#F59E0B',
    },
    storageBannerCritical: {
      backgroundColor: '#FEE2E2',
      borderColor: '#EF4444',
    },
    storageBannerTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: '#92400E',
    },
    storageBannerText: {
      fontSize: 13,
      lineHeight: 18,
      color: '#92400E',
    },
  });
