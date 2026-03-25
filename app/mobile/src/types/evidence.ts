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

export interface EvidenceUploadError {
  code: 'PERMISSION_DENIED' | 'NETWORK_ERROR' | 'UPLOAD_FAILED' | 'COMPRESSION_ERROR' | 'INVALID_FILE';
  message: string;
  userMessage: string;
}

export interface ImageFileInfo {
  uri: string;
  size: number;
  fileName?: string;
  mimeType?: string;
}

export type UploadState = 'idle' | 'selected' | 'compressing' | 'uploading' | 'success' | 'error';
