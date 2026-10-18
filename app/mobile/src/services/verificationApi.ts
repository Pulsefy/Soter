import { apiPost } from './requestLayer';

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
  url: `/verification/upload`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

export const uploadEvidence = async (payload: EvidenceUploadRequest) => {
  const { data } = await apiPost('/verification/upload', payload);
  return data;
};
