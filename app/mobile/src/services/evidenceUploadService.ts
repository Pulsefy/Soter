import { Platform } from 'react-native';
import { EvidenceMetadata, UploadResult, UploadProgress } from '../types/evidence';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

export class EvidenceUploadError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'EvidenceUploadError';
  }
}

/**
 * Uploads evidence image to the verification endpoint with progress tracking
 * 
 * @param imageUri - Local URI of the image to upload
 * @param metadata - Evidence metadata including recipient ID and type
 * @param onProgress - Optional callback for upload progress (0-100)
 * @returns Promise resolving to upload result with evidence ID and URL
 * @throws EvidenceUploadError for network or server errors
 */
export const uploadEvidence = async (
  imageUri: string,
  metadata: EvidenceMetadata,
  onProgress?: (percent: number) => void
): Promise<UploadResult> => {
  try {
    // Create form data for multipart upload
    const formData = new FormData();
    
    // Append the image file
    formData.append('file', {
      uri: imageUri,
      type: 'image/jpeg',
      name: `evidence_${Date.now()}.jpg`,
    } as any);
    
    // Append metadata
    formData.append('recipientId', metadata.recipientId);
    formData.append('evidenceType', metadata.evidenceType);

    // Create XMLHttpRequest for progress tracking
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      });

      // Handle completion
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (error) {
            reject(new EvidenceUploadError('Invalid server response', 'PARSE_ERROR'));
          }
        } else if (xhr.status === 401) {
          reject(new EvidenceUploadError(
            'Authentication required. Please log in again.',
            'AUTH_ERROR',
            xhr.status
          ));
        } else if (xhr.status >= 400 && xhr.status < 500) {
          reject(new EvidenceUploadError(
            'Invalid request. Please check your data and try again.',
            'CLIENT_ERROR',
            xhr.status
          ));
        } else if (xhr.status >= 500) {
          reject(new EvidenceUploadError(
            'Server error. Please try again later.',
            'SERVER_ERROR',
            xhr.status
          ));
        } else {
          reject(new EvidenceUploadError(
            'Upload failed. Please try again.',
            'UNKNOWN_ERROR',
            xhr.status
          ));
        }
      });

      // Handle network errors
      xhr.addEventListener('error', () => {
        reject(new EvidenceUploadError(
          'Network error. Please check your connection and try again.',
          'NETWORK_ERROR'
        ));
      });

      // Handle timeout
      xhr.addEventListener('timeout', () => {
        reject(new EvidenceUploadError(
          'Upload timed out. Please check your connection and try again.',
          'TIMEOUT_ERROR'
        ));
      });

      // Configure and send request
      xhr.timeout = 30000; // 30 seconds timeout
      xhr.open('POST', `${API_URL}/verification/upload`);
      
      // Set headers (add auth token if available in the future)
      xhr.setRequestHeader('Content-Type', 'multipart/form-data');
      
      // Note: Auth token handling would go here when authentication is implemented
      // const authToken = await getAuthToken();
      // if (authToken) {
      //   xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
      // }
      
      xhr.send(formData);
    });
  } catch (error) {
    if (error instanceof EvidenceUploadError) {
      throw error;
    }
    throw new EvidenceUploadError(
      'Failed to prepare upload. Please try again.',
      'PREPARATION_ERROR'
    );
  }
};
