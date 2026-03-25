/**
 * Evidence upload types for Soter humanitarian aid app
 */

export interface EvidenceMetadata {
  recipientId: string;
  evidenceType: 'document' | 'physical';
}

export interface UploadResult {
  success: boolean;
  evidenceId: string;
  url: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export type UploadState = 'idle' | 'selected' | 'compressing' | 'uploading' | 'success' | 'error';

export interface EvidenceCaptureState {
  image: string | null;
  isCompressing: boolean;
  isUploading: boolean;
  uploadProgress: number;
  error: string | null;
  uploadResult: UploadResult | null;
  uploadState: UploadState;
}
