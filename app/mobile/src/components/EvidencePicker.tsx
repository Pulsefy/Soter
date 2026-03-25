import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  onImageCaptured: (uri: string) => void;
  disabled?: boolean;
  imageUri?: string | null;
  onRemoveImage?: () => void;
}

/**
 * Reusable component for image evidence capture
 * Provides camera and gallery selection options with preview functionality
 */
export const EvidencePicker: React.FC<Props> = ({
  onImageCaptured,
  disabled = false,
  imageUri,
  onRemoveImage,
}) => {
  const { colors } = useTheme();

  const handleTakePhoto = () => {
    // This will be handled by the parent component using useEvidenceCapture hook
    // The component just signals the intent
    onImageCaptured('camera');
  };

  const handleChooseFromGallery = () => {
    // This will be handled by the parent component using useEvidenceCapture hook
    onImageCaptured('gallery');
  };

  const handleRemoveImage = () => {
    if (onRemoveImage) {
      onRemoveImage();
    }
  };

  if (imageUri) {
    return (
      <View style={styles.previewContainer}>
        <View style={[styles.imageContainer, { borderColor: colors.border }]}>
          <Image
            source={{ uri: imageUri }}
            style={styles.previewImage}
            resizeMode="cover"
            onError={() => {
              // Handle image load error gracefully
              console.warn('Failed to load preview image');
            }}
          />
          <TouchableOpacity
            style={[styles.removeButton, { backgroundColor: colors.error }]}
            onPress={handleRemoveImage}
            disabled={disabled}
          >
            <Text style={styles.removeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { 
                backgroundColor: colors.surface, 
                borderColor: colors.border,
                opacity: disabled ? 0.5 : 1 
              }
            ]}
            onPress={handleTakePhoto}
            disabled={disabled}
          >
            <Text style={[styles.buttonText, { color: colors.textPrimary }]}>
              📷 Take New Photo
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { 
                backgroundColor: colors.surface, 
                borderColor: colors.border,
                opacity: disabled ? 0.5 : 1 
              }
            ]}
            onPress={handleChooseFromGallery}
            disabled={disabled}
          >
            <Text style={[styles.buttonText, { color: colors.textPrimary }]}>
              🖼️ Choose Other
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.content, { backgroundColor: colors.surface }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          Add Evidence Photo
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Take a photo or choose from your gallery to submit as evidence
        </Text>
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { 
                backgroundColor: colors.brand.primary,
                opacity: disabled ? 0.5 : 1 
              }
            ]}
            onPress={handleTakePhoto}
            disabled={disabled}
          >
            <Text style={styles.primaryButtonText}>
              📷 Take Photo
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { 
                backgroundColor: colors.surface, 
                borderColor: colors.border,
                opacity: disabled ? 0.5 : 1 
              }
            ]}
            onPress={handleChooseFromGallery}
            disabled={disabled}
          >
            <Text style={[styles.buttonText, { color: colors.textPrimary }]}>
              🖼️ Choose from Gallery
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  content: {
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  buttonContainer: {
    gap: 12,
  },
  primaryButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
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
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  previewContainer: {
    width: '100%',
    gap: 16,
  },
  imageContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: 200,
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  removeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
});
