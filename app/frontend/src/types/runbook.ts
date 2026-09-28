export interface RecoveryAction {
  id: string;
  description: string;
  command?: string;
}

export interface RecoveryIssue {
  id: string;
  symptomKey: string;
  causeKey: string;
  severity: 'low' | 'medium' | 'high';
  actions: RecoveryAction[];
  relatedDocs?: string[];
}

export interface ChecklistItem {
  id: string;
  titleKey: string;
  descriptionKey: string;
  href?: string;
  linkLabelKey?: string;
  icon: string;
  autoVerify?: 'wallet' | 'health' | 'never';
}

export interface ChecklistSection {
  id: string;
  titleKey: string;
  subtitleKey: string;
  items: ChecklistItem[];
}

export interface RunbookResponse {
  schema_version: number;
  generated_at: string;
  sections: {
    preDemo: ChecklistSection;
    liveDemo: ChecklistSection;
    postDemo: ChecklistSection;
  };
  failureRecovery: {
    titleKey: string;
    subtitleKey: string;
    issues: RecoveryIssue[];
  };
  contractRegistry: {
    canonicalSourcePath: string;
    generatorScript: string;
    deploymentRegistry: string;
  };
}

export type RunbookState = 'ready' | 'loading' | 'error';

export interface RunbookResult {
  state: RunbookState;
  data: RunbookResponse | null;
  error: Error | null;
  lastChecked: Date | null;
}
