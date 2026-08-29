import type { BackendHealthResponse } from '@/types/health';
import type { AidPackage } from '@/types/aid-package';
import type {
  VerificationInboxItem,
  VerificationInboxResponse,
  VerificationStats,
  InternalNote,
} from '@/types/verification-review';
import type { ContractRegistryResponse } from '@/types/contract-registry';
import type { RunbookResponse } from '@/types/runbook';

export type MockHandler = (
  url: string,
  options?: RequestInit,
) => Promise<Response>;

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return arr;
}

interface StoredCredential {
  id: string;
  publicKey: string;
  transports: string[];
  counter: number;
}

const registeredCredentials: StoredCredential[] = [];

function isoHoursAgo(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function parseJsonBody<T>(options?: RequestInit): T | null {
  if (!options?.body) {
    return null;
  }

  try {
    return JSON.parse(options.body.toString()) as T;
  } catch {
    return null;
  }
}

// Mock in-memory state for verification inbox items and notes
const inboxItems: VerificationInboxItem[] = [
  {
    id: 'vfy-001',
    status: 'pending_review',
    createdAt: isoHoursAgo(4),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: null,
    deepLink: '/verification-review?requestId=vfy-001',
    aiScore: 0.91,
    riskLevel: 'high',
    documentType: 'government_id',
  },
  {
    id: 'vfy-002',
    status: 'pending_review',
    createdAt: isoHoursAgo(9),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: null,
    deepLink: '/verification-review?requestId=vfy-002',
    aiScore: 0.74,
    riskLevel: 'medium',
    documentType: 'utility_bill',
  },
  {
    id: 'vfy-003',
    status: 'approved',
    createdAt: isoHoursAgo(18),
    reviewedAt: isoHoursAgo(14),
    reviewedBy: 'reviewer-demo',
    rejectionReason: null,
    nextStepMessage: 'Approved and ready for disbursement',
    deepLink: '/verification-review?requestId=vfy-003',
    aiScore: 0.22,
    riskLevel: 'low',
    documentType: 'passport',
  },
  {
    id: 'vfy-004',
    status: 'pending_review',
    createdAt: isoHoursAgo(28),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: null,
    deepLink: '/verification-review?requestId=vfy-004',
    aiScore: 0.38,
    riskLevel: 'low',
    documentType: 'residence_card',
  },
  {
    id: 'vfy-005',
    status: 'rejected',
    createdAt: isoHoursAgo(35),
    reviewedAt: isoHoursAgo(30),
    reviewedBy: 'reviewer-demo',
    rejectionReason: 'Document scan is unreadable',
    nextStepMessage: 'Upload a clearer image of the document',
    deepLink: '/verification-review?requestId=vfy-005',
    aiScore: 0.67,
    riskLevel: 'medium',
    documentType: 'government_id',
  },
  {
    id: 'vfy-006',
    status: 'pending_review',
    createdAt: isoHoursAgo(42),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: null,
    deepLink: '/verification-review?requestId=vfy-006',
    aiScore: 0.58,
    riskLevel: 'medium',
    documentType: 'biometric_capture',
  },
  {
    id: 'vfy-007',
    status: 'approved',
    createdAt: isoHoursAgo(54),
    reviewedAt: isoHoursAgo(48),
    reviewedBy: 'reviewer-demo',
    rejectionReason: null,
    nextStepMessage: 'Identity verified successfully',
    deepLink: '/verification-review?requestId=vfy-007',
    aiScore: 0.19,
    riskLevel: 'low',
    documentType: 'driver_license',
  },
  {
    id: 'vfy-008',
    status: 'pending_review',
    createdAt: isoHoursAgo(70),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: null,
    deepLink: '/verification-review?requestId=vfy-008',
    aiScore: 0.87,
    riskLevel: 'high',
    documentType: 'passport',
  },
];

const inboxNotes: InternalNote[] = [
  {
    id: 'note-1',
    entityType: 'verification',
    entityId: 'vfy-002',
    content: 'Cross-check utility bill address against campaign intake record.',
    authorId: 'reviewer-demo',
    category: 'review_context',
    createdAt: isoHoursAgo(8),
    updatedAt: isoHoursAgo(8),
  },
  {
    id: 'note-2',
    entityType: 'verification',
    entityId: 'vfy-002',
    content: 'Address matched, but the bill issue date should be confirmed before approval.',
    authorId: 'reviewer-demo',
    category: 'follow_up',
    createdAt: isoHoursAgo(7),
    updatedAt: isoHoursAgo(7),
  },
];
let inboxNoteCounter = inboxNotes.length;

const webauthnRegisterOptionsHandler: MockHandler = async (url) => {
  const urlObj = new URL(url, 'http://localhost');
  const username = urlObj.searchParams.get('username') ?? 'demo-user';
  const displayName = urlObj.searchParams.get('displayName') ?? 'Demo User';
  const userId = urlObj.searchParams.get('userId') ?? 'user-123';

  const challenge = base64UrlEncode(randomBytes(32));
  const userHandle = base64UrlEncode(new TextEncoder().encode(userId));

  const options = {
    challenge,
    rp: {
      name: 'Soter',
      id: 'localhost',
    },
    user: {
      id: userHandle,
      name: username,
      displayName,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' as const },
      { alg: -257, type: 'public-key' as const },
    ],
    timeout: 60000,
    attestation: 'none' as const,
    authenticatorSelection: {
      authenticatorAttachment: 'platform' as const,
      requireResidentKey: false,
      userVerification: 'required' as const,
    },
    excludeCredentials: registeredCredentials.map((cred) => ({
      id: cred.id,
      type: 'public-key' as const,
      transports: cred.transports as AuthenticatorTransport[],
    })),
  };

  return new Response(JSON.stringify(options), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const webauthnRegisterVerifyHandler: MockHandler = async (_url, options) => {
  if (!options?.body) {
    return new Response(JSON.stringify({ verified: false, message: 'Request body missing' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: {
    id?: string;
    rawId?: string;
    response?: { attestationObject?: string; clientDataJSON?: string };
  };
  try {
    payload = JSON.parse(options.body.toString());
  } catch {
    return new Response(JSON.stringify({ verified: false, message: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!payload.id) {
    return new Response(JSON.stringify({ verified: false, message: 'Credential ID missing' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const existing = registeredCredentials.find((c) => c.id === payload.id);
  if (existing) {
    return new Response(JSON.stringify({ verified: false, message: 'Credential already registered' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const newCred: StoredCredential = {
    id: payload.id,
    publicKey: payload.response?.attestationObject ?? 'mock-pub-key',
    transports: ['internal'],
    counter: 0,
  };
  registeredCredentials.push(newCred);

  return new Response(
    JSON.stringify({
      verified: true,
      credentialId: newCred.id,
      message: 'Registration successful',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

const webauthnAuthOptionsHandler: MockHandler = async (url) => {
  const urlObj = new URL(url, 'http://localhost');
  const userId = urlObj.searchParams.get('userId');

  const challenge = base64UrlEncode(randomBytes(32));

  const allowCredentials = registeredCredentials.map((cred) => ({
    id: cred.id,
    type: 'public-key' as const,
    transports: cred.transports as AuthenticatorTransport[],
  }));

  const options = {
    challenge,
    timeout: 60000,
    rpId: 'localhost',
    allowCredentials,
    userVerification: 'required' as const,
    extensions: {
      uvm: true,
    },
  };

  return new Response(JSON.stringify(options), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const webauthnAuthVerifyHandler: MockHandler = async (_url, options) => {
  if (!options?.body) {
    return new Response(JSON.stringify({ verified: false, message: 'Request body missing' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: { id?: string; response?: { authenticatorData?: string; clientDataJSON?: string; signature?: string } };
  try {
    payload = JSON.parse(options.body.toString());
  } catch {
    return new Response(JSON.stringify({ verified: false, message: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!payload.id) {
    return new Response(JSON.stringify({ verified: false, message: 'Credential ID missing' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cred = registeredCredentials.find((c) => c.id === payload.id);
  if (!cred) {
    return new Response(JSON.stringify({ verified: false, message: 'Credential not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  cred.counter += 1;

  return new Response(
    JSON.stringify({
      verified: true,
      credentialId: cred.id,
      counter: cred.counter,
      message: 'Authentication successful',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

const healthHandler: MockHandler = async () => {
  const mockResponse: BackendHealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0-mock',
    service: 'soter-backend-mock',
    details: {
      uptime: 12345,
    },
  };

  return new Response(JSON.stringify(mockResponse), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const ALL_PACKAGES: AidPackage[] = [
  {
    id: 'AID-001',
    title: 'Emergency Food Relief',
    region: 'Eastern Region',
    amount: '12,500 USDC',
    recipients: 250,
    status: 'Active',
    token: 'USDC',
  },
  {
    id: 'AID-002',
    title: 'Medical Supplies',
    region: 'Northern Zone',
    amount: '8,000 USDC',
    recipients: 120,
    status: 'Active',
    token: 'USDC',
  },
  {
    id: 'AID-003',
    title: 'Shelter & Housing',
    region: 'Coastal Area',
    amount: '30,000 XLM',
    recipients: 75,
    status: 'Claimed',
    token: 'XLM',
  },
  {
    id: 'AID-004',
    title: 'Water Sanitation Project',
    region: 'Southern District',
    amount: '5,000 EURC',
    recipients: 400,
    status: 'Expired',
    token: 'EURC',
  },
  {
    id: 'AID-005',
    title: 'Education Support',
    region: 'Western Highlands',
    amount: '15,000 USDC',
    recipients: 300,
    status: 'Active',
    token: 'USDC',
  },
  {
    id: 'AID-006',
    title: 'Child Nutrition Program',
    region: 'Central Valley',
    amount: '20,000 XLM',
    recipients: 180,
    status: 'Claimed',
    token: 'XLM',
  },
  {
    id: 'AID-007',
    title: 'Refugee Camp Support',
    region: 'Northern Zone',
    amount: '25,000 EURC',
    recipients: 600,
    status: 'Expired',
    token: 'EURC',
  },
  {
    id: 'AID-008',
    title: 'Disaster Recovery Aid',
    region: 'Eastern Region',
    amount: '50,000 USDC',
    recipients: 850,
    status: 'Active',
    token: 'USDC',
  },
];

const aidPackagesHandler: MockHandler = async (url) => {
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    urlObj = new URL(url, 'http://localhost');
  }

  const search = urlObj.searchParams.get('search') ?? '';
  const status = urlObj.searchParams.get('status') ?? '';
  const token = urlObj.searchParams.get('token') ?? '';
  const page = Math.max(1, parseInt(urlObj.searchParams.get('page') ?? '1', 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(urlObj.searchParams.get('size') ?? '10', 10) || 10));
  const sortBy = urlObj.searchParams.get('sortBy') ?? 'id';
  const sortDirection = urlObj.searchParams.get('sortDirection') ?? 'asc';
  const isLegacyListRequest =
    !urlObj.searchParams.has('page') &&
    !urlObj.searchParams.has('size') &&
    !urlObj.searchParams.has('sortBy') &&
    !urlObj.searchParams.has('sortDirection');

  let results = [...ALL_PACKAGES];

  if (search) {
    const lower = search.toLowerCase();
    results = results.filter(
      p =>
        p.id.toLowerCase().includes(lower) ||
        p.title.toLowerCase().includes(lower) ||
        p.region.toLowerCase().includes(lower),
    );
  }

  if (status) {
    results = results.filter(p => p.status === status);
  }

  if (token) {
    results = results.filter(p => p.token === token);
  }

  // Sort
  if (sortBy && sortBy in results[0]) {
    results.sort((a, b) => {
      const aVal = a[sortBy as keyof AidPackage] ?? '';
      const bVal = b[sortBy as keyof AidPackage] ?? '';
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDirection === 'desc' ? -cmp : cmp;
    });
  }

  if (isLegacyListRequest) {
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const total = results.length;
  const totalPages = Math.ceil(total / size);
  const startIdx = (page - 1) * size;
  const paginatedResults = results.slice(startIdx, startIdx + size);

  return new Response(JSON.stringify({
    data: paginatedResults,
    total,
    page,
    size,
    totalPages,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

let campaignIdCounter = 3;
const campaignsStore: Array<{id:string; name:string; status:string; budget:number; metadata?:Record<string, unknown>; createdAt:string; updatedAt:string; archivedAt?: string | null;}> = [
  {
    id: '1',
    name: 'Winter Relief 2026',
    status: 'active',
    budget: 25000,
    metadata: { token: 'USDC', expiry: '2026-12-31' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  },
  {
    id: '2',
    name: 'Medical Outreach',
    status: 'paused',
    budget: 15000,
    metadata: { token: 'USDC', expiry: '2026-08-15' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  },
];

const campaignsHandler: MockHandler = async () => {
  return new Response(
    JSON.stringify({ success: true, data: campaignsStore, message: 'Campaigns fetched successfully' }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

const campaignCreateHandler: MockHandler = async (_url, options) => {
  if (!options?.body) {
    return new Response(JSON.stringify({ success: false, message: 'Request body missing' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const payload = JSON.parse(options.body.toString());
  const record = {
    id: String(campaignIdCounter++),
    name: payload.name,
    status: payload.status ?? 'draft',
    budget: payload.budget,
    metadata: payload.metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  };

  campaignsStore.unshift(record);

  return new Response(JSON.stringify({ success: true, data: record, message: 'Campaign created successfully' }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

const campaignUpdateHandler: MockHandler = async (url, options) => {
  const urlParts = url.split('?')[0].split('/');
  const id = urlParts[urlParts.length - 1];
  const campaign = campaignsStore.find(item => item.id === id);

  if (!campaign) {
    return new Response(JSON.stringify({ success: false, message: 'Campaign not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  if (!options?.body) {
    return new Response(JSON.stringify({ success: false, message: 'Request body missing' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const payload = JSON.parse(options.body.toString());

  if (payload.name !== undefined) campaign.name = payload.name;
  if (payload.budget !== undefined) campaign.budget = payload.budget;
  if (payload.status !== undefined) campaign.status = payload.status;
  if (payload.metadata !== undefined) campaign.metadata = payload.metadata;
  if (payload.status === 'archived') {
    campaign.archivedAt = new Date().toISOString();
  }

  campaign.updatedAt = new Date().toISOString();

  return new Response(JSON.stringify({ success: true, data: campaign, message: 'Campaign updated successfully' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const campaignGetHandler: MockHandler = async (url) => {
  const urlParts = url.split('?')[0].split('/');
  const id = urlParts[urlParts.length - 1];
  const campaign = campaignsStore.find(item => item.id === id);

  if (!campaign) {
    return new Response(JSON.stringify({ success: false, message: 'Campaign not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ success: true, data: campaign, message: 'Campaign fetched successfully' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const campaignTimelineHandler: MockHandler = async (url) => {
  const parts = url.split('?')[0].split('/');
  const id = parts[parts.length - 2];
  const campaign = campaignsStore.find(item => item.id === id);

  if (!campaign) {
    return new Response(JSON.stringify({ success: false, message: 'Campaign not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const now = Date.now();
  const data = [
    {
      id: 'issuance',
      label: 'Issuance',
      status: 'completed',
      occurredAt: campaign.createdAt,
      description: 'Campaign issued with recipient package preparation started.',
    },
    {
      id: 'verification',
      label: 'Verification',
      status: campaign.status === 'paused' ? 'delayed' : 'completed',
      occurredAt: new Date(now - 1000 * 60 * 60 * 12).toISOString(),
      description: campaign.status === 'paused' ? 'Verification updates are delayed.' : 'Recipient verifications are flowing from the review queue.',
      correlationId: 'mock-review-correlation-001',
    },
    {
      id: 'claim',
      label: 'Claim',
      status: 'completed',
      occurredAt: new Date(now - 1000 * 60 * 45).toISOString(),
      description: 'Onchain claim transaction confirmed for the latest package.',
      transactionHash: '6f6b4a9f6bb87ac7e5f0783fd7f4ff1d4c0a9df7db49e2749d7d117e7d2be001',
      explorerUrl: 'https://stellar.expert/explorer/testnet/tx/6f6b4a9f6bb87ac7e5f0783fd7f4ff1d4c0a9df7db49e2749d7d117e7d2be001',
      correlationId: 'mock-claim-correlation-001',
    },
    {
      id: 'disbursement',
      label: 'Disbursement',
      status: campaign.status === 'active' ? 'pending' : 'delayed',
      description: 'Waiting for disbursement confirmation from ledger processing.',
    },
  ];

  return new Response(JSON.stringify({ success: true, data, message: 'Campaign timeline fetched successfully' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const activityFeedHandler: MockHandler = async () => {
  const now = Date.now();
  const data = [
    {
      id: 'notification:mock-1',
      type: 'notification',
      status: 'processing',
      title: 'SMS notification enqueued',
      description: 'Recipient claim reminder is waiting for delivery confirmation.',
      timestamp: new Date(now - 1000 * 60 * 8).toISOString(),
      read: false,
      correlationId: 'mock-sms-correlation-001',
      linkHref: '/notifications/outbox/mock-1',
      linkLabel: 'Open outbox record',
    },
    {
      id: 'review:mock-2',
      type: 'review',
      status: 'pending',
      title: 'Verification pending review',
      description: 'A new verification request is ready for reviewer action.',
      timestamp: new Date(now - 1000 * 60 * 24).toISOString(),
      read: false,
      linkHref: '/verification-review?requestId=mock-2',
      linkLabel: 'Open review',
    },
    {
      id: 'audit:mock-3',
      type: 'audit',
      status: 'succeeded',
      title: 'update Campaign',
      description: 'Actor demo-admin updated campaign 1',
      timestamp: new Date(now - 1000 * 60 * 90).toISOString(),
      read: true,
      correlationId: 'mock-audit-correlation-001',
      linkHref: '/campaigns/1',
      linkLabel: 'Open record',
    },
  ];

  return new Response(JSON.stringify({ success: true, data, message: 'Activity feed fetched' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

interface MockValidationMessage {
  severity: 'warning' | 'error';
  field?: string;
  message: string;
}

interface MockValidationRow {
  rowNumber: number;
  status: 'valid' | 'warning' | 'error';
  messages: MockValidationMessage[];
  values: { name: string; wallet: string; phone: string };
}

function escapeCsvValue(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function requireImportFormData(options?: RequestInit):
  | { error: Response }
  | { file: File; campaignId: string } {
  const body = options?.body;

  if (!(body instanceof FormData)) {
    return {
      error: new Response(JSON.stringify({ success: false, message: 'Form data is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  const file = body.get('file');
  if (!(file instanceof File)) {
    return {
      error: new Response(JSON.stringify({ success: false, message: 'CSV file is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  const rawCampaignId = body.get('campaignId');
  const campaignId = typeof rawCampaignId === 'string' && rawCampaignId.trim() ? rawCampaignId.trim() : 'unknown-campaign';

  return { file, campaignId };
}

async function validateImportCsvText(csvText: string): Promise<MockValidationRow[]> {
  const lines = csvText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const [headerLine, ...dataLines] = lines;
  const headers = (headerLine ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  const normalizedHeaders = headers.map(header => header.toLowerCase().replace(/[_\s-]+/g, ''));
  const nameIndex = normalizedHeaders.findIndex(header => ['name', 'fullname', 'recipientname'].includes(header));
  const walletIndex = normalizedHeaders.findIndex(header => ['wallet', 'walletaddress', 'stellarwallet', 'publickey'].includes(header));
  const phoneIndex = normalizedHeaders.findIndex(header => ['phone', 'phonenumber', 'mobile'].includes(header));

  return dataLines.map((line, index) => {
    const values = line.split(',').map(value => value.trim());
    const name = nameIndex >= 0 ? (values[nameIndex] ?? '') : '';
    const wallet = walletIndex >= 0 ? (values[walletIndex] ?? '') : '';
    const phone = phoneIndex >= 0 ? (values[phoneIndex] ?? '') : '';
    const messages: MockValidationMessage[] = [];

    if (!name) {
      messages.push({ severity: 'error', field: 'fullName', message: 'Recipient name is required.' });
    }

    if (!wallet) {
      messages.push({ severity: 'error', field: 'wallet', message: 'Wallet address is required.' });
    } else if (wallet.length < 10) {
      messages.push({ severity: 'warning', field: 'wallet', message: 'Wallet address looks shorter than expected.' });
    }

    if (!phone) {
      messages.push({ severity: 'warning', field: 'phone', message: 'Phone number is missing.' });
    }

    const status: MockValidationRow['status'] =
      messages.some(message => message.severity === 'error')
        ? 'error'
        : messages.some(message => message.severity === 'warning')
          ? 'warning'
          : 'valid';

    return {
      rowNumber: index + 1,
      status,
      messages,
      values: { name, wallet, phone },
    };
  });
}

const recipientsImportValidateHandler: MockHandler = async (_url, options) => {
  const parsed = requireImportFormData(options);
  if ('error' in parsed) {
    return parsed.error;
  }

  const csvText = await parsed.file.text();
  const rows = await validateImportCsvText(csvText);

  return new Response(
    JSON.stringify({
      success: true,
      rows: rows.map(row => ({
        rowNumber: row.rowNumber,
        status: row.status,
        messages: row.messages,
      })),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
};

const recipientsImportReportHandler: MockHandler = async (_url, options) => {
  const parsed = requireImportFormData(options);
  if ('error' in parsed) {
    return parsed.error;
  }

  const { file, campaignId } = parsed;
  const csvText = await file.text();
  const rows = await validateImportCsvText(csvText);

  const summary = rows.reduce(
    (acc, row) => {
      acc.totalRows += 1;
      acc[`${row.status}Rows`] += 1;
      return acc;
    },
    { totalRows: 0, validRows: 0, warningRows: 0, errorRows: 0 },
  );

  const generatedAt = new Date().toISOString();
  const reportId = `rpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const metadata = [
    '# Soter recipient import validation report',
    `# reportId: ${reportId}`,
    `# campaignId: ${campaignId}`,
    `# generatedAt: ${generatedAt}`,
    '# source: backend',
    `# totalRows: ${summary.totalRows}`,
    `# validRows: ${summary.validRows}`,
    `# warningRows: ${summary.warningRows}`,
    `# errorRows: ${summary.errorRows}`,
  ].join('\n');

  const headerRow = 'rowNumber,status,severity,field,message,name,wallet,phone';
  const bodyLines: string[] = [];

  for (const row of rows) {
    if (row.messages.length === 0) {
      bodyLines.push(
        [row.rowNumber, row.status, '', '', '', row.values.name, row.values.wallet, row.values.phone]
          .map(value => escapeCsvValue(String(value)))
          .join(','),
      );
      continue;
    }

    for (const message of row.messages) {
      bodyLines.push(
        [
          row.rowNumber,
          row.status,
          message.severity,
          message.field ?? '',
          message.message,
          row.values.name,
          row.values.wallet,
          row.values.phone,
        ]
          .map(value => escapeCsvValue(String(value)))
          .join(','),
      );
    }
  }

  const report = `${metadata}\n${headerRow}\n${bodyLines.join('\n')}\n`;

  return new Response(report, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="recipient-import-report-${campaignId}.csv"`,
      'X-Report-Id': reportId,
      'X-Report-Generated-At': generatedAt,
    },
  });
};

const recipientsImportConfirmHandler: MockHandler = async (_url, options) => {
  const body = options?.body;

  if (!(body instanceof FormData)) {
    return new Response(JSON.stringify({ success: false, message: 'Form data is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const file = body.get('file');
  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ success: false, message: 'CSV file is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, message: `Recipient import queued successfully for ${file.name}.` }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// GET /v1/verification-inbox
const inboxListHandler: MockHandler = async (url) => {
  const urlObj = new URL(url, 'http://localhost');
  const page = Math.max(1, parseInt(urlObj.searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(urlObj.searchParams.get('limit') ?? '10', 10) || 10));
  const status = urlObj.searchParams.get('status') ?? '';
  const riskLevel = urlObj.searchParams.get('riskLevel') ?? '';

  let filteredItems = [...inboxItems];
  if (status) {
    filteredItems = filteredItems.filter(item => item.status === status);
  }
  if (riskLevel) {
    filteredItems = filteredItems.filter(item => item.riskLevel === riskLevel);
  }

  const total = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const startIdx = (page - 1) * limit;
  const paginatedItems = filteredItems.slice(startIdx, startIdx + limit);

  const response: VerificationInboxResponse = {
    items: paginatedItems,
    total,
    page,
    limit,
    totalPages,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// GET /v1/verification-inbox/stats
const inboxStatsHandler: MockHandler = async () => {
  const stats: VerificationStats = {
    pending_review: inboxItems.filter(item => item.status === 'pending_review').length,
    approved: inboxItems.filter(item => item.status === 'approved').length,
    rejected: inboxItems.filter(item => item.status === 'rejected').length,
    needs_resubmission: inboxItems.filter(item => item.status === 'needs_resubmission').length,
    total: inboxItems.length,
  };

  return new Response(JSON.stringify(stats), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// GET /v1/verification-inbox/:id
const inboxDetailHandler: MockHandler = async (url) => {
  const parts = url.split('?')[0].split('/');
  const id = parts[parts.length - 1];
  const item = inboxItems.find(i => i.id === id);

  if (!item) {
    return new Response(JSON.stringify({ message: 'Verification request not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(item), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /v1/verification-inbox/:id/approve
const inboxApproveHandler: MockHandler = async (url, options) => {
  const parts = url.split('?')[0].split('/');
  const id = parts[parts.length - 2]; // Remove /approve from path
  const item = inboxItems.find(i => i.id === id);

  if (!item) {
    return new Response(JSON.stringify({ message: 'Verification request not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (item.status !== 'pending_review') {
    return new Response(JSON.stringify({ message: 'Only pending verification requests can be approved' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = parseJsonBody<{ nextStepMessage?: string; internalNote?: string }>(options);

  item.status = 'approved';
  item.reviewedAt = new Date().toISOString();
  item.reviewedBy = 'reviewer-demo';
  item.rejectionReason = null;
  item.nextStepMessage = payload?.nextStepMessage ?? null;

  if (payload?.internalNote) {
    const noteTimestamp = new Date().toISOString();
    inboxNotes.push({
      id: `note-${++inboxNoteCounter}`,
      entityType: 'verification',
      entityId: id,
      content: payload.internalNote,
      authorId: 'reviewer-demo',
      category: 'approval_note',
      createdAt: noteTimestamp,
      updatedAt: noteTimestamp,
    });
  }

  return new Response(JSON.stringify(item), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /v1/verification-inbox/:id/reject
const inboxRejectHandler: MockHandler = async (url, options) => {
  const parts = url.split('?')[0].split('/');
  const id = parts[parts.length - 2]; // Remove /reject from path
  const item = inboxItems.find(i => i.id === id);

  if (!item) {
    return new Response(JSON.stringify({ message: 'Verification request not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (item.status !== 'pending_review') {
    return new Response(JSON.stringify({ message: 'Only pending verification requests can be rejected' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = parseJsonBody<{ rejectionReason?: string; nextStepMessage?: string }>(options);

  item.status = 'rejected';
  item.reviewedAt = new Date().toISOString();
  item.reviewedBy = 'reviewer-demo';
  item.rejectionReason = payload?.rejectionReason ?? 'No reason provided';
  item.nextStepMessage = payload?.nextStepMessage ?? null;

  return new Response(JSON.stringify(item), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /v1/verification-inbox/:id/request-resubmission
const inboxResubmitHandler: MockHandler = async (url, options) => {
  const parts = url.split('?')[0].split('/');
  const id = parts[parts.length - 2]; // Remove /request-resubmission from path
  const item = inboxItems.find(i => i.id === id);

  if (!item) {
    return new Response(JSON.stringify({ message: 'Verification request not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (item.status !== 'pending_review') {
    return new Response(JSON.stringify({ message: 'Only pending verification requests can be sent back for resubmission' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = parseJsonBody<{ rejectionReason?: string; nextStepMessage?: string }>(options);

  item.status = 'needs_resubmission';
  item.reviewedAt = new Date().toISOString();
  item.reviewedBy = 'reviewer-demo';
  item.rejectionReason = payload?.rejectionReason ?? null;
  item.nextStepMessage = payload?.nextStepMessage ?? 'Please resubmit with required documentation';

  return new Response(JSON.stringify(item), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// GET /v1/verification-inbox/:id/notes
const inboxGetNotesHandler: MockHandler = async (url) => {
  const parts = url.split('?')[0].split('/');
  const id = parts[parts.length - 2]; // Remove /notes from path
  const item = inboxItems.find(i => i.id === id);

  if (!item) {
    return new Response(JSON.stringify({ message: 'Verification request not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const itemNotes = inboxNotes.filter(note => note.entityId === id);

  return new Response(JSON.stringify(itemNotes), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /v1/verification-inbox/:id/notes
const inboxAddNoteHandler: MockHandler = async (url, options) => {
  const parts = url.split('?')[0].split('/');
  const id = parts[parts.length - 2];
  const item = inboxItems.find(i => i.id === id);

  if (!item) {
    return new Response(JSON.stringify({ message: 'Verification request not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: { content?: string; category?: string } = {};
  if (options?.body) {
    try {
      payload = JSON.parse(options.body.toString());
    } catch { /* ignore */ }
  }

  const now = new Date().toISOString();
  const note: InternalNote = {
    id: `note-${++inboxNoteCounter}`,
    entityType: 'verification',
    entityId: id,
    content: payload.content ?? '',
    authorId: 'reviewer-demo',
    category: payload.category ?? null,
    createdAt: now,
    updatedAt: now,
  };
  inboxNotes.push(note);

  return new Response(JSON.stringify(note), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

const dashboardSummaryHandler: MockHandler = async () => {
  const totalClaims = inboxItems.length;
  const totalPackages = ALL_PACKAGES.length;
  const pendingReviews = inboxItems.filter(
    i => i.status === 'pending_review',
  ).length;
  const totalDisbursements = ALL_PACKAGES.filter(
    p => p.status === 'Claimed',
  ).length;

  return new Response(
    JSON.stringify({
      totalClaims,
      totalPackages,
      pendingReviews,
      totalDisbursements,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

const contractRegistryHandler: MockHandler = async () => {
  const registry: ContractRegistryResponse = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    contracts: {
      aid_escrow: {
        version: '0.2.0',
        networks: {
          testnet: {
            contract_id: 'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
            version: '0.1.0',
            deployed_at: '2026-06-03',
          },
        },
      },
    },
    source: {
      canonical_path: 'app/onchain/deployments/contract-registry.json',
      generator_script: 'app/onchain/scripts/generate-registry.py',
      deployment_registry: 'app/onchain/deployments/registry.json',
    },
  };

  return new Response(JSON.stringify(registry), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const runbookHandler: MockHandler = async () => {
  const runbook: RunbookResponse = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    sections: {
      preDemo: {
        id: 'pre-demo',
        titleKey: 'preDemoTitle',
        subtitleKey: 'preDemoSubtitle',
        items: [
          {
            id: 'pre-system-health',
            titleKey: 'preSystemHealth',
            descriptionKey: 'preSystemHealthDesc',
            icon: 'Server',
            autoVerify: 'health',
          },
          {
            id: 'pre-network-config',
            titleKey: 'preNetworkConfig',
            descriptionKey: 'preNetworkConfigDesc',
            icon: 'Globe',
            autoVerify: 'never',
          },
          {
            id: 'pre-contract-registry',
            titleKey: 'preContractRegistry',
            descriptionKey: 'preContractRegistryDesc',
            href: '/demo-checklist#contract-registry',
            linkLabelKey: 'openContractRegistry',
            icon: 'FileCode',
            autoVerify: 'never',
          },
          {
            id: 'pre-wallet-connect',
            titleKey: 'preWalletConnect',
            descriptionKey: 'preWalletConnectDesc',
            href: '/',
            linkLabelKey: 'goHome',
            icon: 'Wallet',
            autoVerify: 'wallet',
          },
          {
            id: 'pre-faucet-funding',
            titleKey: 'preFaucetFunding',
            descriptionKey: 'preFaucetFundingDesc',
            icon: 'Droplet',
            autoVerify: 'never',
          },
          {
            id: 'pre-backend-smoke',
            titleKey: 'preBackendSmoke',
            descriptionKey: 'preBackendSmokeDesc',
            href: '/dashboard',
            linkLabelKey: 'openDashboard',
            icon: 'Activity',
            autoVerify: 'never',
          },
        ],
      },
      liveDemo: {
        id: 'live-demo',
        titleKey: 'liveDemoTitle',
        subtitleKey: 'liveDemoSubtitle',
        items: [
          {
            id: 'live-campaign-browse',
            titleKey: 'liveCampaignBrowse',
            descriptionKey: 'liveCampaignBrowseDesc',
            href: '/campaigns',
            linkLabelKey: 'openCampaigns',
            icon: 'Megaphone',
            autoVerify: 'never',
          },
          {
            id: 'live-claim-submit',
            titleKey: 'liveClaimSubmit',
            descriptionKey: 'liveClaimSubmitDesc',
            href: '/claim-receipt?claimId=demo-test',
            linkLabelKey: 'openClaimFlow',
            icon: 'FileText',
            autoVerify: 'never',
          },
          {
            id: 'live-verification-review',
            titleKey: 'liveVerificationReview',
            descriptionKey: 'liveVerificationReviewDesc',
            href: '/verification-review',
            linkLabelKey: 'openVerificationReview',
            icon: 'CheckSquare',
            autoVerify: 'never',
          },
          {
            id: 'live-onchain-receipt',
            titleKey: 'liveOnchainReceipt',
            descriptionKey: 'liveOnchainReceiptDesc',
            href: '/claim-receipt?claimId=demo-verify',
            linkLabelKey: 'openReceiptPage',
            icon: 'Receipt',
            autoVerify: 'never',
          },
          {
            id: 'live-dashboard-metrics',
            titleKey: 'liveDashboardMetrics',
            descriptionKey: 'liveDashboardMetricsDesc',
            href: '/dashboard',
            linkLabelKey: 'openDashboard',
            icon: 'BarChart3',
            autoVerify: 'never',
          },
        ],
      },
      postDemo: {
        id: 'post-demo',
        titleKey: 'postDemoTitle',
        subtitleKey: 'postDemoSubtitle',
        items: [
          {
            id: 'post-data-cleanup',
            titleKey: 'postDataCleanup',
            descriptionKey: 'postDataCleanupDesc',
            icon: 'Trash2',
            autoVerify: 'never',
          },
          {
            id: 'post-ledger-reconcile',
            titleKey: 'postLedgerReconcile',
            descriptionKey: 'postLedgerReconcileDesc',
            icon: 'Database',
            autoVerify: 'never',
          },
          {
            id: 'post-state-export',
            titleKey: 'postStateExport',
            descriptionKey: 'postStateExportDesc',
            icon: 'Download',
            autoVerify: 'never',
          },
          {
            id: 'post-debrief-notes',
            titleKey: 'postDebriefNotes',
            descriptionKey: 'postDebriefNotesDesc',
            icon: 'Edit3',
            autoVerify: 'never',
          },
        ],
      },
    },
    failureRecovery: {
      titleKey: 'recoveryTitle',
      subtitleKey: 'recoverySubtitle',
      issues: [
        {
          id: 'rpc-timeout',
          symptomKey: 'issueRpcTimeoutSymptom',
          causeKey: 'issueRpcTimeoutCause',
          severity: 'medium',
          actions: [
            { id: 'rpc-1', description: 'Verify RPC endpoint URL matches canonical network config', command: 'curl -I https://soroban-testnet.stellar.org:443' },
            { id: 'rpc-2', description: 'Check network connectivity and firewall rules' },
            { id: 'rpc-3', description: 'Switch to alternative RPC endpoint if available' },
            { id: 'rpc-4', description: 'Retry request with exponential backoff' },
          ],
          relatedDocs: ['DEPLOY_TESTNET_RUNBOOK.md §9.1'],
        },
        {
          id: 'rate-limiting',
          symptomKey: 'issueRateLimitSymptom',
          causeKey: 'issueRateLimitCause',
          severity: 'low',
          actions: [
            { id: 'rl-1', description: 'Wait 2-5 minutes before retrying', command: 'Start-Sleep -Seconds 120' },
            { id: 'rl-2', description: 'Use dedicated RPC provider if public endpoint is throttled' },
            { id: 'rl-3', description: 'Batch requests where possible' },
          ],
          relatedDocs: ['DEPLOY_TESTNET_RUNBOOK.md §9.2'],
        },
      ],
    },
  };

  return new Response(JSON.stringify(runbook), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const methodNotAllowed = () =>
  new Response(JSON.stringify({ message: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });

const campaignsCollectionHandler: MockHandler = async (url, options) => {
  const method = (options?.method ?? 'GET').toUpperCase();

  if (method === 'GET') {
    return campaignsHandler(url, options);
  }

  if (method === 'POST') {
    return campaignCreateHandler(url, options);
  }

  return methodNotAllowed();
};

const campaignDynamicHandler: MockHandler = async (url, options) => {
  const pathname = new URL(url, 'http://localhost').pathname;
  const method = (options?.method ?? 'GET').toUpperCase();

  if (pathname.endsWith('/timeline')) {
    return campaignTimelineHandler(url, options);
  }

  if (method === 'GET') {
    return campaignGetHandler(url, options);
  }

  if (method === 'PATCH' || method === 'PUT') {
    return campaignUpdateHandler(url, options);
  }

  return methodNotAllowed();
};

const verificationDynamicHandler: MockHandler = async (url, options) => {
  const pathname = new URL(url, 'http://localhost').pathname;
  const method = (options?.method ?? 'GET').toUpperCase();

  if (pathname.endsWith('/approve') && method === 'POST') {
    return inboxApproveHandler(url, options);
  }

  if (pathname.endsWith('/reject') && method === 'POST') {
    return inboxRejectHandler(url, options);
  }

  if (pathname.endsWith('/request-resubmission') && method === 'POST') {
    return inboxResubmitHandler(url, options);
  }

  if (pathname.endsWith('/notes')) {
    if (method === 'GET') {
      return inboxGetNotesHandler(url, options);
    }

    if (method === 'POST') {
      return inboxAddNoteHandler(url, options);
    }
  }

  if (method === 'GET') {
    return inboxDetailHandler(url, options);
  }

  return methodNotAllowed();
};

export const handlers: Record<string, MockHandler> = {
  '/health': healthHandler,
  '/aid-packages': aidPackagesHandler,
  '/auth/webauthn/register/options': webauthnRegisterOptionsHandler,
  '/auth/webauthn/register/verify': webauthnRegisterVerifyHandler,
  '/auth/webauthn/auth/options': webauthnAuthOptionsHandler,
  '/auth/webauthn/auth/verify': webauthnAuthVerifyHandler,
  '/campaigns': campaignsCollectionHandler,
  '/campaigns/:id': campaignDynamicHandler,
  '/notifications/activity-feed': activityFeedHandler,
  '/analytics/global-stats': dashboardSummaryHandler,
  '/contract-registry': contractRegistryHandler,
  '/runbook': runbookHandler,
  '/recipients/import/validate': recipientsImportValidateHandler,
  '/recipients/import/report': recipientsImportReportHandler,
  '/recipients/import/confirm': recipientsImportConfirmHandler,
  '/v1/verification-inbox': inboxListHandler,
  '/v1/verification-inbox/stats': inboxStatsHandler,
  '/v1/verification-inbox/:id': verificationDynamicHandler,
};
