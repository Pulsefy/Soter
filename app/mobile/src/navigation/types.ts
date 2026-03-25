export type RootStackParamList = {
  Home: undefined;
  Health: undefined;
  AidOverview: undefined;
  AidDetails: { aidId: string };
  Settings: undefined;
  Scanner: undefined;
  EvidenceUpload: { 
    recipientId?: string; 
    evidenceType?: 'document' | 'physical' 
  };
};
