import { Platform } from 'react-native';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

export interface EvidenceUploadRequest {
  aidId: string;
  filename: string;
  contentType: string;
  imageBase64: string;
  source?: 'mobile' | 'web';
}

export interface EvidenceUploadPayload {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
}

export const buildEvidenceUploadPayload = (
  payload: EvidenceUploadRequest,
): EvidenceUploadPayload => ({
  url: `${API_URL}/verification/upload`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

export const uploadEvidence = async (payload: EvidenceUploadRequest) => {
  const response = await fetch(`${API_URL}/verification/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
};
