export type RootStackParamList = {
  Home: undefined;
  Health: undefined;
  AidOverview: undefined;
  AidDetails: { aidId: string };
  Settings: undefined;
  EvidenceUpload: { 
    recipientId?: string; 
    evidenceType?: 'document' | 'physical' 
  };
};
