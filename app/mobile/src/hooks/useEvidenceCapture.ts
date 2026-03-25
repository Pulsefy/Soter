import { useState, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { uploadEvidence } from '../services/evidenceUploadService';
import type { 
  EvidenceMetadata, 
  UploadResult, 
  EvidenceUploadError, 
  ImageFileInfo 
} from '../types/evidence';

interface UseEvidenceCaptureState {
  image: string | null;
  originalImageInfo: ImageFileInfo | null;
  compressedImageInfo: ImageFileInfo | null;
  isCompressing: boolean;
  isUploading: boolean;
  uploadProgress: number;
  error: string | null;
  uploadResult: UploadResult | null;
}

interface UseEvidenceCaptureActions {
  openCamera: () => Promise<void>;
  openGallery: () => Promise<void>;
  uploadImage: (metadata: EvidenceMetadata) => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

/**
 * Hook for capturing, compressing, and uploading evidence images
 * Handles camera/gallery permissions, image compression, and upload progress
 */
export const useEvidenceCapture = (): UseEvidenceCaptureState & UseEvidenceCaptureActions => {
  const [state, setState] = useState<UseEvidenceCaptureState>({
    image: null,
    originalImageInfo: null,
    compressedImageInfo: null,
    isCompressing: false,
    isUploading: false,
    uploadProgress: 0,
    error: null,
    uploadResult: null,
  });

  const updateState = useCallback((updates: Partial<UseEvidenceCaptureState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const clearError = useCallback(() => {
    updateState({ error: null });
  }, [updateState]);

  const reset = useCallback(() => {
    setState({
      image: null,
      originalImageInfo: null,
      compressedImageInfo: null,
      isCompressing: false,
      isUploading: false,
      uploadProgress: 0,
      error: null,
      uploadResult: null,
    });
  }, []);

  const getImageFileInfo = async (uri: string): Promise<ImageFileInfo> => {
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      return {
        uri,
        size: blob.size,
        fileName: uri.split('/').pop() || 'image.jpg',
        mimeType: blob.type || 'image/jpeg',
      };
    } catch (error) {
      console.warn('Failed to get image file info:', error);
      return {
        uri,
        size: 0,
        fileName: 'image.jpg',
        mimeType: 'image/jpeg',
      };
    }
  };

  const compressImage = async (imageUri: string): Promise<string> => {
    try {
      // Get original file info
      const originalInfo = await getImageFileInfo(imageUri);
      
      // Skip compression if file is already small enough (< 200KB)
      if (originalInfo.size > 0 && originalInfo.size < 200 * 1024) {
        updateState({ 
          originalImageInfo, 
          compressedImageInfo: originalInfo 
        });
        return imageUri;
      }

      updateState({ isCompressing: true });

      // Compress image: max 800px on longest side, JPEG quality 0.7
      const result = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 800, height: 800 } }],
        {
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: false,
        }
      );

      const compressedInfo = await getImageFileInfo(result.uri);
      
      updateState({ 
        originalImageInfo, 
        compressedImageInfo,
        isCompressing: false 
      });

      return result.uri;
    } catch (error) {
      updateState({ 
        isCompressing: false,
        error: 'Failed to optimize image. Please try again.',
      });
      throw error;
    }
  };

  const requestCameraPermission = async (): Promise<boolean> => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status === 'granted') {
        return true;
      } else if (status === 'denied') {
        updateState({ 
          error: 'Camera permission is required to take photos. Please enable it in your device settings.' 
        });
        return false;
      } else {
        // permanently denied
        Alert.alert(
          'Camera Permission Required',
          'Camera access is required to take photos. Please enable camera permission in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => ImagePicker.openSettings() },
          ]
        );
        return false;
      }
    } catch (error) {
      updateState({ 
        error: 'Failed to request camera permission. Please try again.' 
      });
      return false;
    }
  };

  const requestGalleryPermission = async (): Promise<boolean> => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status === 'granted') {
        return true;
      } else if (status === 'denied') {
        updateState({ 
          error: 'Gallery permission is required to choose photos. Please enable it in your device settings.' 
        });
        return false;
      } else {
        // permanently denied
        Alert.alert(
          'Gallery Permission Required',
          'Gallery access is required to choose photos. Please enable gallery permission in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => ImagePicker.openSettings() },
          ]
        );
        return false;
      }
    } catch (error) {
      updateState({ 
        error: 'Failed to request gallery permission. Please try again.' 
      });
      return false;
    }
  };

  const openCamera = useCallback(async (): Promise<void> => {
    clearError();
    
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const imageUri = result.assets[0].uri;
        const compressedUri = await compressImage(imageUri);
        updateState({ image: compressedUri });
      }
    } catch (error) {
      updateState({ 
        error: 'Failed to open camera. Please try again.' 
      });
    }
  }, [clearError]);

  const openGallery = useCallback(async (): Promise<void> => {
    clearError();
    
    const hasPermission = await requestGalleryPermission();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const imageUri = result.assets[0].uri;
        const compressedUri = await compressImage(imageUri);
        updateState({ image: compressedUri });
      }
    } catch (error) {
      updateState({ 
        error: 'Failed to open gallery. Please try again.' 
      });
    }
  }, [clearError]);

  const uploadImage = useCallback(async (metadata: EvidenceMetadata): Promise<void> => {
    if (!state.image) {
      updateState({ error: 'No image selected for upload.' });
      return;
    }

    clearError();
    updateState({ isUploading: true, uploadProgress: 0 });

    try {
      const result = await uploadEvidence(
        state.image,
        metadata,
        (percent) => {
          updateState({ uploadProgress: percent });
        }
      );

      updateState({ 
        uploadResult: result, 
        isUploading: false,
        uploadProgress: 100 
      });
    } catch (error) {
      const uploadError = error as EvidenceUploadError;
      updateState({ 
        error: uploadError.userMessage || 'Upload failed. Please try again.',
        isUploading: false,
        uploadProgress: 0 
      });
    }
  }, [state.image, clearError]);

  return {
    ...state,
    openCamera,
    openGallery,
    uploadImage,
    reset,
    clearError,
  };
};
