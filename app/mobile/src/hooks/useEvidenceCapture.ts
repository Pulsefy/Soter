import { useState, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { uploadEvidence, EvidenceUploadError } from '../services/evidenceUploadService';
import { 
  EvidenceMetadata, 
  UploadResult, 
  EvidenceCaptureState, 
  UploadState 
} from '../types/evidence';

interface UseEvidenceCaptureProps {
  recipientId: string;
  evidenceType: 'document' | 'physical';
}

/**
 * Hook for capturing, compressing, and uploading evidence images
 * Handles camera/gallery permissions, image compression, and upload progress
 */
export const useEvidenceCapture = ({ 
  recipientId, 
  evidenceType 
}: UseEvidenceCaptureProps) => {
  const [state, setState] = useState<EvidenceCaptureState>({
    image: null,
    isCompressing: false,
    isUploading: false,
    uploadProgress: 0,
    error: null,
    uploadResult: null,
    uploadState: 'idle',
  });

  const updateState = useCallback((updates: Partial<EvidenceCaptureState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  /**
   * Request camera permission and open camera
   */
  const openCamera = useCallback(async () => {
    try {
      // Request camera permission
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      
      if (!permissionResult.granted) {
        if (permissionResult.canAskAgain) {
          updateState({
            error: 'Camera permission is required to take photos. Please grant permission when prompted.',
            uploadState: 'error'
          });
        } else {
          updateState({
            error: 'Camera permission is permanently denied. Please enable camera access in your device settings.',
            uploadState: 'error'
          });
        }
        return;
      }

      // Launch camera
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        base64: false,
      });

      if (!result.canceled && result.assets[0]) {
        updateState({
          image: result.assets[0].uri,
          error: null,
          uploadState: 'selected'
        });
      }
    } catch (error) {
      updateState({
        error: 'Failed to open camera. Please try again.',
        uploadState: 'error'
      });
    }
  }, [updateState]);

  /**
   * Request media library permission and open gallery
   */
  const openGallery = useCallback(async () => {
    try {
      // Request media library permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (!permissionResult.granted) {
        if (permissionResult.canAskAgain) {
          updateState({
            error: 'Gallery permission is required to select photos. Please grant permission when prompted.',
            uploadState: 'error'
          });
        } else {
          updateState({
            error: 'Gallery permission is permanently denied. Please enable gallery access in your device settings.',
            uploadState: 'error'
          });
        }
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        base64: false,
      });

      if (!result.canceled && result.assets[0]) {
        updateState({
          image: result.assets[0].uri,
          error: null,
          uploadState: 'selected'
        });
      }
    } catch (error) {
      updateState({
        error: 'Failed to open gallery. Please try again.',
        uploadState: 'error'
      });
    }
  }, [updateState]);

  /**
   * Compress image to reduce file size for upload
   */
  const compressImage = useCallback(async (imageUri: string): Promise<string> => {
    try {
      updateState({ isCompressing: true, uploadState: 'compressing' });

      // Get file info to check size
      const response = await fetch(imageUri);
      const blob = await response.blob();
      const fileSizeKB = Math.round(blob.size / 1024);

      // Skip compression if file is already small enough
      if (fileSizeKB < 200) {
        updateState({ isCompressing: false });
        return imageUri;
      }

      // Compress image: max 800px on longest side, JPEG quality 0.7
      const manipResult = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 800, height: 800 } }],
        {
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: false,
        }
      );

      // Get compressed file size
      const compressedResponse = await fetch(manipResult.uri);
      const compressedBlob = await compressedResponse.blob();
      const compressedSizeKB = Math.round(compressedBlob.size / 1024);

      console.log(`Image compressed: ${fileSizeKB}KB → ${compressedSizeKB}KB`);

      updateState({ isCompressing: false });
      return manipResult.uri;
    } catch (error) {
      updateState({ 
        isCompressing: false, 
        error: 'Failed to optimize image. Using original.',
        uploadState: 'selected'
      });
      return imageUri;
    }
  }, [updateState]);

  /**
   * Upload the selected image with progress tracking
   */
  const uploadImage = useCallback(async () => {
    if (!state.image) {
      updateState({
        error: 'No image selected for upload.',
        uploadState: 'error'
      });
      return;
    }

    try {
      updateState({ 
        isUploading: true, 
        uploadProgress: 0, 
        error: null,
        uploadState: 'uploading'
      });

      // Compress image first
      const compressedImageUri = await compressImage(state.image);

      // Prepare metadata
      const metadata: EvidenceMetadata = {
        recipientId,
        evidenceType,
      };

      // Upload with progress tracking
      const result = await uploadEvidence(
        compressedImageUri,
        metadata,
        (percent) => {
          updateState({ uploadProgress: percent });
        }
      );

      updateState({
        isUploading: false,
        uploadProgress: 100,
        uploadResult: result,
        uploadState: 'success',
        error: null,
      });
    } catch (error) {
      let errorMessage = 'Upload failed. Please try again.';
      
      if (error instanceof EvidenceUploadError) {
        errorMessage = error.message;
      }

      updateState({
        isUploading: false,
        uploadProgress: 0,
        error: errorMessage,
        uploadState: 'error',
      });
    }
  }, [state.image, recipientId, evidenceType, compressImage, updateState]);

  /**
   * Reset all state to initial values
   */
  const reset = useCallback(() => {
    setState({
      image: null,
      isCompressing: false,
      isUploading: false,
      uploadProgress: 0,
      error: null,
      uploadResult: null,
      uploadState: 'idle',
    });
  }, []);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    updateState({ error: null });
  }, [updateState]);

  return {
    // State
    image: state.image,
    isCompressing: state.isCompressing,
    isUploading: state.isUploading,
    uploadProgress: state.uploadProgress,
    error: state.error,
    uploadResult: state.uploadResult,
    uploadState: state.uploadState,
    
    // Actions
    openCamera,
    openGallery,
    uploadImage,
    reset,
    clearError,
  };
};
