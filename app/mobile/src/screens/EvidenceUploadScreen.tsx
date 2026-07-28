import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useSync } from '../contexts/SyncContext';
import { buildEvidenceUploadPayload, EvidenceUploadRequest } from '../services/verificationApi';

type Props = NativeStackScreenProps<RootStackParamList, 'EvidenceUpload'>;

const MAX_IMAGE_WIDTH = 1024;
const JPEG_QUALITY = 0.65;

export const EvidenceUploadScreen: React.FC<Props> = ({ route, navigation }) => {
  const { aidId } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isConnected, queueEvidenceUpload, getActionsForAid, retryAction } = useSync();

  const uploadActions = useMemo(() => getActionsForAid(aidId), [getActionsForAid, aidId]);
  const activeUpload = useMemo(() => uploadActions.find((a) => a.type === 'evidence-upload'), [uploadActions]);

  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [compressedBase64, setCompressedBase64] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('evidence.jpg');
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const compressPhoto = useCallback(async (uri: string) => {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MAX_IMAGE_WIDTH } }],
      { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );

    if (!result.base64) {
      throw new Error('Unable to compress image');
    }

    setSelectedImageUri(result.uri);
    setCompressedBase64(result.base64);
    setFilename(`evidence-${Date.now()}.jpg`);
  }, []);

  const pickImage = useCallback(async () => {
    setStatusMessage(null);
    setError(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Photo library access is required to select evidence.');
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
  }, [compressPhoto]);

  const takePhoto = useCallback(async () => {
    setStatusMessage(null);
    setError(null);

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Camera access is required to capture evidence.');
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
  }, [compressPhoto]);

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
      const result = await queueEvidenceUpload(aidId, buildEvidenceUploadPayload(payload));

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

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Step 1: Choose a photo</Text>
        <Text style={styles.helpText}>
          Use your camera or photo library to capture a document, receipt, or other proof.
        </Text>
        <View style={styles.buttonGroup}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={takePhoto}
            accessibilityRole="button"
            accessibilityLabel="Take a photo of evidence"
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={pickImage}
            accessibilityRole="button"
            accessibilityLabel="Select an evidence photo from your library"
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryButtonText}>Select Photo</Text>
          </TouchableOpacity>
        </View>
      </View>

      {selectedImageUri ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Step 2: Preview</Text>
          <Image source={{ uri: selectedImageUri }} style={styles.previewImage} />
          <Text style={styles.previewLabel}>{filename}</Text>
          <View style={styles.buttonGroup}> 
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={resetSelection}
              accessibilityRole="button"
              accessibilityLabel="Choose a different photo"
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>Choose Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Step 3: Upload</Text>
        <Text style={styles.helpText}>
          Compressed image upload saves data on low-bandwidth connections.
        </Text>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={handleUpload}
          disabled={!compressedBase64 || uploading || !!activeUpload}
          accessibilityRole="button"
          accessibilityLabel={uploading ? 'Uploading evidence' : 'Upload evidence now'}
          accessibilityState={{ busy: uploading, disabled: !compressedBase64 || uploading || !!activeUpload }}
          activeOpacity={0.8}
        >
          {uploading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Upload Evidence</Text>
          )}
        </TouchableOpacity>
        {statusMessage ? <Text style={styles.statusText}>{statusMessage}</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
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
                    backgroundColor: activeUpload.state === 'failed' ? colors.error : colors.brand.primary 
                  }
                ]} 
              />
            </View>
            
            <View style={styles.progressRow}>
              <Text style={styles.progressText}>
                {Math.round((activeUpload.payload.progress || 0) * 100)}% Completed
              </Text>
              {activeUpload.state === 'failed' && (
                <TouchableOpacity 
                  style={styles.retryButton} 
                  onPress={() => retryAction(activeUpload.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Retry failed upload"
                >
                  <Text style={styles.retryButtonText}>Retry</Text>
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
            Offline mode: evidence upload will queue and resend when the device reconnects.
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
      marginTop: 12,
      fontSize: 14,
      color: colors.info,
    },
    errorText: {
      marginTop: 12,
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
  });
