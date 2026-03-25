import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeContext';
import { EvidencePicker } from '../components/EvidencePicker';
import { useEvidenceCapture } from '../hooks/useEvidenceCapture';
import type { UploadState, EvidenceMetadata } from '../types/evidence';

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
 * Evidence upload screen with camera integration and animated progress tracking
 * Handles all states: idle, selected, compressing, uploading, success, error
 */
export const EvidenceUploadScreen: React.FC<Props> = ({ 
  navigation, 
  route 
}) => {
  const { colors } = useTheme();
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [progressAnim] = useState(new Animated.Value(0));
  
  const {
    image,
    originalImageInfo,
    compressedImageInfo,
    isCompressing,
    isUploading,
    uploadProgress,
    error,
    uploadResult,
    openCamera,
    openGallery,
    uploadImage,
    reset,
    clearError,
  } = useEvidenceCapture();

  // Get recipient info from route params or use defaults
  const recipientId = route.params?.recipientId || 'default-recipient';
  const evidenceType = route.params?.evidenceType || 'physical';

  // Update upload state based on hook states
  useEffect(() => {
    if (isCompressing) {
      setUploadState('compressing');
    } else if (isUploading) {
      setUploadState('uploading');
    } else if (uploadResult) {
      setUploadState('success');
    } else if (error) {
      setUploadState('error');
    } else if (image) {
      setUploadState('selected');
    } else {
      setUploadState('idle');
    }
  }, [isCompressing, isUploading, uploadResult, error, image]);

  // Animate progress bar
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: uploadProgress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [uploadProgress, progressAnim]);

  const handleImageCapture = async (source: 'camera' | 'gallery') => {
    clearError();
    try {
      if (source === 'camera') {
        await openCamera();
      } else {
        await openGallery();
      }
    } catch (error) {
      // Error is handled by the hook
    }
  };

  const handleRemoveImage = () => {
    reset();
    setUploadState('idle');
  };

  const handleSubmit = async () => {
    if (!image) return;

    const metadata: EvidenceMetadata = {
      recipientId,
      evidenceType,
    };

    try {
      await uploadImage(metadata);
    } catch (error) {
      // Error is handled by the hook
    }
  };

  const handleRetry = () => {
    clearError();
    if (image) {
      handleSubmit();
    }
  };

  const handleDone = () => {
    navigation.goBack();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 KB';
    const kb = bytes / 1024;
    return `${kb.toFixed(0)} KB`;
  };

  const renderIdleState = () => (
    <View style={styles.content}>
      <EvidencePicker
        onImageCaptured={handleImageCapture}
        disabled={false}
      />
      <TouchableOpacity
        style={[
          styles.submitButton,
          { 
            backgroundColor: colors.brand.primary,
            opacity: 0.5 
          }
        ]}
        disabled={true}
      >
        <Text style={styles.submitButtonText}>Submit Evidence</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSelectedState = () => (
    <View style={styles.content}>
      <EvidencePicker
        onImageCaptured={handleImageCapture}
        disabled={false}
        imageUri={image}
        onRemoveImage={handleRemoveImage}
      />
      
      {originalImageInfo && compressedImageInfo && (
        <View style={[styles.compressionInfo, { backgroundColor: colors.infoBg }]}>
          <Text style={[styles.compressionText, { color: colors.info }]}>
            📊 Image optimized: {formatFileSize(originalImageInfo.size)} → {formatFileSize(compressedImageInfo.size)}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.submitButton,
          { 
            backgroundColor: colors.brand.primary,
            opacity: 1 
          }
        ]}
        onPress={handleSubmit}
        disabled={false}
      >
        <Text style={styles.submitButtonText}>Submit Evidence</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCompressingState = () => (
    <View style={styles.processingContainer}>
      <View style={[styles.processingCard, { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
        <Text style={[styles.processingTitle, { color: colors.textPrimary }]}>
          Optimizing image...
        </Text>
        <Text style={[styles.processingSubtitle, { color: colors.textSecondary }]}>
          Making your file smaller for faster upload
        </Text>
      </View>
    </View>
  );

  const renderUploadingState = () => (
    <View style={styles.processingContainer}>
      <View style={[styles.processingCard, { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
        <Text style={[styles.processingTitle, { color: colors.textPrimary }]}>
          Uploading... {uploadProgress}%
        </Text>
        <Text style={[styles.processingSubtitle, { color: colors.textSecondary }]}>
          Sending your evidence to the server
        </Text>
        
        {/* Animated progress bar */}
        <View style={[styles.progressContainer, { backgroundColor: colors.border }]}>
          <Animated.View
            style={[
              styles.progressBar,
              {
                backgroundColor: colors.brand.primary,
                width: progressAnim.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
        
        <Text style={[styles.progressText, { color: colors.textSecondary }]}>
          {uploadProgress}% Complete
        </Text>
      </View>
    </View>
  );

  const renderSuccessState = () => (
    <View style={styles.processingContainer}>
      <View style={[styles.processingCard, { backgroundColor: colors.surface }]}>
        <View style={[styles.successIcon, { backgroundColor: colors.success }]}>
          <Text style={styles.successIconText}>✓</Text>
        </View>
        <Text style={[styles.processingTitle, { color: colors.textPrimary }]}>
          Evidence Submitted!
        </Text>
        <Text style={[styles.processingSubtitle, { color: colors.textSecondary }]}>
          Your evidence has been successfully uploaded
        </Text>
        
        {uploadResult && (
          <View style={[styles.resultInfo, { backgroundColor: colors.infoBg }]}>
            <Text style={[styles.resultText, { color: colors.info }]}>
              Evidence ID: {uploadResult.evidenceId}
            </Text>
          </View>
        )}
        
        <TouchableOpacity
          style={[
            styles.submitButton,
            { backgroundColor: colors.brand.primary }
          ]}
          onPress={handleDone}
        >
          <Text style={styles.submitButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.processingContainer}>
      <View style={[styles.processingCard, { backgroundColor: colors.surface }]}>
        <View style={[styles.errorIcon, { backgroundColor: colors.error }]}>
          <Text style={styles.errorIconText}>!</Text>
        </View>
        <Text style={[styles.processingTitle, { color: colors.textPrimary }]}>
          Upload Failed
        </Text>
        <Text style={[styles.processingSubtitle, { color: colors.textSecondary }]}>
          {error || 'An unexpected error occurred'}
        </Text>
        
        <View style={styles.errorActions}>
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { 
                backgroundColor: colors.surface, 
                borderColor: colors.border 
              }
            ]}
            onPress={handleRetry}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>
              Try Again
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { 
                backgroundColor: colors.surface, 
                borderColor: colors.border 
              }
            ]}
            onPress={reset}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>
              Start Over
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const renderContent = () => {
    switch (uploadState) {
      case 'idle':
        return renderIdleState();
      case 'selected':
        return renderSelectedState();
      case 'compressing':
        return renderCompressingState();
      case 'uploading':
        return renderUploadingState();
      case 'success':
        return renderSuccessState();
      case 'error':
        return renderErrorState();
      default:
        return renderIdleState();
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={[styles.backButtonText, { color: colors.brand.primary }]}>
            ← Back
          </Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          Upload Evidence
        </Text>
        <View style={styles.headerSpacer} />
      </View>
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderContent()}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 60,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  content: {
    gap: 20,
  },
  submitButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  compressionInfo: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  compressionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  processingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  processingCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  processingTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  processingSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  progressContainer: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successIconText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: 'bold',
  },
  errorIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorIconText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: 'bold',
  },
  resultInfo: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 24,
  },
  resultText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  errorActions: {
    width: '100%',
    gap: 12,
  },
  secondaryButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
