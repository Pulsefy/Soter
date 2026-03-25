import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useEvidenceCapture } from '../hooks/useEvidenceCapture';
import { EvidencePicker } from '../components/EvidencePicker';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';

type EvidenceUploadScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'EvidenceUpload'
>;

interface Props {
  navigation: EvidenceUploadScreenNavigationProp;
  route: {
    params?: {
      recipientId?: string;
      evidenceType?: 'document' | 'physical';
    };
  };
}

/**
 * Evidence upload screen with camera integration and progress tracking
 * Handles all UI states: idle, selected, compressing, uploading, success, error
 */
export const EvidenceUploadScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Get route params with defaults
  const { recipientId = 'default-recipient', evidenceType = 'document' } = route.params || {};

  // Use evidence capture hook
  const {
    image,
    isCompressing,
    isUploading,
    uploadProgress,
    error,
    uploadResult,
    uploadState,
    openCamera,
    openGallery,
    uploadImage,
    reset,
    clearError,
  } = useEvidenceCapture({ recipientId, evidenceType });

  const handleImageCaptured = (uri: string) => {
    // This is handled by the hook when camera/gallery returns an image
  };

  const handleRemoveImage = () => {
    reset();
  };

  const handleRetry = () => {
    if (error) {
      clearError();
      if (image) {
        uploadImage();
      }
    }
  };

  const handleBackToHome = () => {
    navigation.navigate('Home');
  };

  const handleUploadAnother = () => {
    reset();
  };

  // Render different UI based on state
  const renderContent = () => {
    switch (uploadState) {
      case 'compressing':
        return (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={colors.brand.primary} />
            <Text style={styles.stateTitle}>Optimizing image...</Text>
            <Text style={styles.stateSubtitle}>
              Reducing file size for faster upload
            </Text>
          </View>
        );

      case 'uploading':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill, 
                    { width: `${uploadProgress}%` }
                  ]} 
                />
              </View>
              <Text style={styles.progressText}>
                Uploading... {uploadProgress}%
              </Text>
            </View>
            <Text style={styles.stateSubtitle}>
              Sending evidence to verification server
            </Text>
          </View>
        );

      case 'success':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.successIcon}>
              <Text style={styles.successEmoji}>✅</Text>
            </View>
            <Text style={styles.stateTitle}>Evidence Submitted!</Text>
            <Text style={styles.stateSubtitle}>
              Your evidence has been successfully uploaded
            </Text>
            {uploadResult && (
              <View style={styles.resultContainer}>
                <Text style={styles.resultLabel}>Evidence ID:</Text>
                <Text style={styles.resultValue} selectable>
                  {uploadResult.evidenceId}
                </Text>
              </View>
            )}
            <View style={styles.successActions}>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={handleBackToHome}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>Back to Home</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={handleUploadAnother}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryButtonText}>Upload Another</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 'error':
        return (
          <View style={styles.stateContainer}>
            <View style={styles.errorIcon}>
              <Text style={styles.errorEmoji}>⚠️</Text>
            </View>
            <Text style={styles.stateTitle}>Upload Failed</Text>
            <Text style={styles.stateSubtitle}>{error}</Text>
            <View style={styles.errorActions}>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={handleRetry}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={reset}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryButtonText}>Start Over</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      default:
        return (
          <View style={styles.defaultContainer}>
            <EvidencePicker
              onImageCaptured={handleImageCaptured}
              selectedImage={image}
              onRemoveImage={handleRemoveImage}
              onOpenCamera={openCamera}
              onOpenGallery={openGallery}
              disabled={isCompressing || isUploading}
            />

            {image && uploadState === 'selected' && (
              <View style={styles.uploadSection}>
                <TouchableOpacity
                  style={[styles.button, styles.primaryButton]}
                  onPress={uploadImage}
                  disabled={isCompressing || isUploading}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryButtonText}>Submit Evidence</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Upload Evidence</Text>
          <View style={styles.placeholder} />
        </View>

        {renderContent()}
      </ScrollView>
    </SafeAreaView>
  );
};

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContainer: {
      flexGrow: 1,
      padding: 24,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 32,
    },
    backButton: {
      padding: 8,
      borderRadius: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    backIcon: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    placeholder: {
      width: 36,
    },
    defaultContainer: {
      gap: 24,
    },
    uploadSection: {
      alignItems: 'center',
    },
    stateContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 60,
      gap: 16,
    },
    stateTitle: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    stateSubtitle: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 24,
      paddingHorizontal: 20,
    },
    progressContainer: {
      width: '100%',
      maxWidth: 300,
      alignItems: 'center',
      gap: 12,
    },
    progressBar: {
      width: '100%',
      height: 8,
      backgroundColor: colors.border,
      borderRadius: 4,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.brand.primary,
      borderRadius: 4,
    },
    progressText: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    successIcon: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.success + '20',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    successEmoji: {
      fontSize: 40,
    },
    resultContainer: {
      backgroundColor: colors.surface,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      width: '100%',
      maxWidth: 300,
      marginTop: 8,
    },
    resultLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    resultValue: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    errorIcon: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.errorBg,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    errorEmoji: {
      fontSize: 40,
    },
    successActions: {
      gap: 12,
      width: '100%',
      maxWidth: 300,
    },
    errorActions: {
      gap: 12,
      width: '100%',
      maxWidth: 300,
    },
    button: {
      paddingVertical: 16,
      paddingHorizontal: 24,
      borderRadius: 12,
      alignItems: 'center',
    },
    primaryButton: {
      backgroundColor: colors.brand.primary,
    },
    secondaryButton: {
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.border,
    },
    primaryButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
    },
    secondaryButtonText: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
  });
