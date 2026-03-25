import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';

interface Props {
  /** Callback when an image is captured or selected */
  onImageCaptured: (uri: string) => void;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Currently selected image URI */
  selectedImage?: string | null;
  /** Callback to remove selected image */
  onRemoveImage?: () => void;
  /** Callback to open camera */
  onOpenCamera?: () => void;
  /** Callback to open gallery */
  onOpenGallery?: () => void;
}

/**
 * Reusable component for image selection with camera and gallery options
 * Shows thumbnail preview when image is selected with remove option
 */
export const EvidencePicker: React.FC<Props> = ({
  onImageCaptured,
  disabled = false,
  selectedImage = null,
  onRemoveImage,
  onOpenCamera,
  onOpenGallery,
}) => {
  const { colors } = useTheme();
  const [imageLoadError, setImageLoadError] = useState(false);
  const styles = makeStyles(colors);

  const handleImageError = () => {
    setImageLoadError(true);
  };

  const handleRemoveImage = () => {
    setImageLoadError(false);
    if (onRemoveImage) {
      onRemoveImage();
    }
  };

  if (selectedImage) {
    return (
      <View style={styles.previewContainer}>
        <Text style={styles.previewLabel}>Selected Image</Text>
        
        <View style={styles.imageContainer}>
          {imageLoadError ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>Failed to load image</Text>
            </View>
          ) : (
            <Image
              source={{ uri: selectedImage }}
              style={styles.previewImage}
              resizeMode="cover"
              onError={handleImageError}
            />
          )}
          
          <TouchableOpacity
            style={styles.removeButton}
            onPress={handleRemoveImage}
            disabled={disabled}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Remove selected image"
          >
            <Text style={styles.removeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Add Evidence</Text>
      <Text style={styles.subtitle}>
        Take a photo or choose from your gallery to submit as evidence
      </Text>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, styles.cameraButton, disabled && styles.buttonDisabled]}
          onPress={onOpenCamera}
          disabled={disabled || !onOpenCamera}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Take a photo with camera"
        >
          <Text style={styles.buttonIcon}>📷</Text>
          <Text style={styles.buttonText}>Take Photo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.galleryButton, disabled && styles.buttonDisabled]}
          onPress={onOpenGallery}
          disabled={disabled || !onOpenGallery}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Choose photo from gallery"
        >
          <Text style={styles.buttonIcon}>🖼️</Text>
          <Text style={styles.buttonText}>Choose from Gallery</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      padding: 20,
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 8,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
      lineHeight: 20,
    },
    buttonContainer: {
      gap: 12,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      paddingHorizontal: 20,
      borderRadius: 12,
      gap: 12,
    },
    cameraButton: {
      backgroundColor: colors.brand.primary,
    },
    galleryButton: {
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.border,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonIcon: {
      fontSize: 20,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '600',
    },
    previewContainer: {
      padding: 20,
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    previewLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 12,
      textAlign: 'center',
    },
    imageContainer: {
      position: 'relative',
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    previewImage: {
      width: '100%',
      height: 200,
      borderRadius: 12,
    },
    removeButton: {
      position: 'absolute',
      top: 8,
      right: 8,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      borderRadius: 16,
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
    },
    errorContainer: {
      width: '100%',
      height: 200,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.errorBg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.errorBorder,
    },
    errorIcon: {
      fontSize: 32,
      marginBottom: 8,
    },
    errorText: {
      fontSize: 14,
      color: colors.error,
      textAlign: 'center',
    },
  });
