import { Platform } from 'react-native';
import type { EvidenceMetadata, UploadResult, EvidenceUploadError } from '../types/evidence';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

/**
 * Uploads evidence image to the verification endpoint with progress tracking
 * 
 * @param imageUri - Local URI of the image to upload
 * @param metadata - Evidence metadata including recipient ID and type
 * @param onProgress - Optional callback for upload progress (0-100)
 * @returns Promise resolving to upload result with evidence ID and URL
 * @throws EvidenceUploadError with user-friendly messages
 */
export const uploadEvidence = async (
  imageUri: string,
  metadata: EvidenceMetadata,
  onProgress?: (percent: number) => void
): Promise<UploadResult> => {
  try {
    // Create FormData for multipart upload
    const formData = new FormData();
    formData.append('image', {
      uri: imageUri,
      type: 'image/jpeg',
      name: 'evidence.jpg',
    } as any);
    formData.append('recipientId', metadata.recipientId);
    formData.append('evidenceType', metadata.evidenceType);

    // Create XMLHttpRequest for progress tracking
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      // Track upload progress
      if (onProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress(percent);
          }
        });
      }

      // Handle completion
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve({
              success: true,
              evidenceId: response.evidenceId,
              url: response.url,
            });
          } catch (parseError) {
            const error: EvidenceUploadError = {
              code: 'UPLOAD_FAILED',
              message: 'Invalid response from server',
              userMessage: 'Server response was invalid. Please try again.',
            };
            reject(error);
          }
        } else if (xhr.status === 401) {
          const error: EvidenceUploadError = {
            code: 'UPLOAD_FAILED',
            message: 'Authentication required',
            userMessage: 'Please log in again to upload evidence.',
          };
          reject(error);
        } else if (xhr.status === 413) {
          const error: EvidenceUploadError = {
            code: 'UPLOAD_FAILED',
            message: 'File too large',
            userMessage: 'Image is too large. Please choose a smaller image.',
          };
          reject(error);
        } else {
          const error: EvidenceUploadError = {
            code: 'UPLOAD_FAILED',
            message: `HTTP ${xhr.status}: ${xhr.statusText}`,
            userMessage: 'Upload failed. Please check your connection and try again.',
          };
          reject(error);
        }
      });

      // Handle errors
      xhr.addEventListener('error', () => {
        const error: EvidenceUploadError = {
          code: 'NETWORK_ERROR',
          message: 'Network request failed',
          userMessage: 'Network connection failed. Please check your internet and try again.',
        };
        reject(error);
      });

      xhr.addEventListener('timeout', () => {
        const error: EvidenceUploadError = {
          code: 'NETWORK_ERROR',
          message: 'Request timeout',
          userMessage: 'Upload timed out. Please check your connection and try again.',
        };
        reject(error);
      });

      // Configure and send request
      xhr.timeout = 30000; // 30 second timeout
      xhr.open('POST', `${API_URL}/verification/upload`);
      
      // Note: Auth headers would be added here based on existing auth patterns
      // Following the existing pattern from other services in the codebase
      
      xhr.send(formData);
    });
  } catch (error) {
    // Handle unexpected errors
    const uploadError: EvidenceUploadError = {
      code: 'UPLOAD_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
      userMessage: 'An unexpected error occurred. Please try again.',
    };
    throw uploadError;
  }
};
