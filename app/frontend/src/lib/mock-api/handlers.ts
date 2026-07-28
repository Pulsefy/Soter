import type { BackendHealthResponse } from '@/types/health';
import type { AidPackage } from '@/types/aid-package';
import type {
  VerificationInboxItem,
  VerificationInboxResponse,
  VerificationStats,
  InternalNote,
  VerificationStatus,
} from '@/types/verification-review';

export type MockHandler = (
  url: string,
  options?: RequestInit,
) => Promise<Response>;

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
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

  return new Response(JSON.stringify(results), {
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

const recipientsImportValidateHandler: MockHandler = async (_url, options) => {
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

  const csvText = await file.text();
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

  const rows = dataLines.map((line, index) => {
    const values = line.split(',').map(value => value.trim());
    const name = nameIndex >= 0 ? (values[nameIndex] ?? '') : '';
    const wallet = walletIndex >= 0 ? (values[walletIndex] ?? '') : '';
    const phone = phoneIndex >= 0 ? (values[phoneIndex] ?? '') : '';
    const messages: Array<{ severity: 'warning' | 'error'; field?: string; message: string }> = [];

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

    const status =
      messages.some(message => message.severity === 'error')
        ? 'error'
        : messages.some(message => message.severity === 'warning')
          ? 'warning'
          : 'valid';

    return {
      rowNumber: index + 1,
      status,
      messages,
    };
  });

  return new Response(JSON.stringify({ success: true, rows }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
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

// ═══════════════════════════════════════════════════════════════════════════
// Verification Inbox Mock Data & Handlers
// ═══════════════════════════════════════════════════════════════════════════

let inboxNoteCounter = 5;

const inboxItems: VerificationInboxItem[] = [
  {
    id: 'vfy-001',
    status: 'pending_review',
    createdAt: new Date('2026-07-20T10:00:00.000Z').toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: 'Review identity documents for authenticity',
    deepLink: '/verification/vfy-001',
    aiScore: 0.42,
    riskLevel: 'medium',
    documentType: 'national_id',
  },
  {
    id: 'vfy-002',
    status: 'pending_review',
    createdAt: new Date('2026-07-19T15:30:00.000Z').toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: 'Cross-reference proof-of-life with recipient registry',
    deepLink: '/verification/vfy-002',
    aiScore: 0.88,
    riskLevel: 'high',
    documentType: 'proof_of_life',
  },
  {
    id: 'vfy-003',
    status: 'approved',
    createdAt: new Date('2026-07-15T08:00:00.000Z').toISOString(),
    reviewedAt: new Date('2026-07-16T14:00:00.000Z').toISOString(),
    reviewedBy: 'reviewer-demo',
    rejectionReason: null,
    nextStepMessage: 'Verification approved. Proceed to disbursement.',
    deepLink: '/verification/vfy-003',
    aiScore: 0.15,
    riskLevel: 'low',
    documentType: 'national_id',
  },
  {
    id: 'vfy-004',
    status: 'rejected',
    createdAt: new Date('2026-07-14T12:00:00.000Z').toISOString(),
    reviewedAt: new Date('2026-07-16T10:00:00.000Z').toISOString(),
    reviewedBy: 'reviewer-demo',
    rejectionReason: 'Document appears fraudulent',
    nextStepMessage: 'Please resubmit with valid documentation',
    deepLink: '/verification/vfy-004',
    aiScore: 0.95,
    riskLevel: 'high',
    documentType: 'national_id',
  },
  {
    id: 'vfy-005',
    status: 'needs_resubmission',
    createdAt: new Date('2026-07-13T09:00:00.000Z').toISOString(),
    reviewedAt: new Date('2026-07-17T11:00:00.000Z').toISOString(),
    reviewedBy: 'reviewer-demo',
    rejectionReason: 'Document expired',
    nextStepMessage: 'Please submit a current government-issued ID',
    deepLink: '/verification/vfy-005',
    aiScore: 0.55,
    riskLevel: 'medium',
    documentType: 'national_id',
  },
  {
    id: 'vfy-006',
    status: 'pending_review',
    createdAt: new Date('2026-07-18T14:00:00.000Z').toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: 'Verify biometric match score against threshold',
    deepLink: '/verification/vfy-006',
    aiScore: 0.62,
    riskLevel: 'medium',
    documentType: 'biometric',
  },
  {
    id: 'vfy-007',
    status: 'approved',
    createdAt: new Date('2026-07-10T11:00:00.000Z').toISOString(),
    reviewedAt: new Date('2026-07-12T16:00:00.000Z').toISOString(),
    reviewedBy: 'reviewer-demo',
    rejectionReason: null,
    nextStepMessage: 'Verification approved. Ready for claim.',
    deepLink: '/verification/vfy-007',
    aiScore: 0.08,
    riskLevel: 'low',
    documentType: 'proof_of_life',
  },
  {
    id: 'vfy-008',
    status: 'pending_review',
    createdAt: new Date('2026-07-17T16:00:00.000Z').toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: 'Validate document expiry and issuer authority',
    deepLink: '/verification/vfy-008',
    aiScore: 0.73,
    riskLevel: 'high',
    documentType: 'national_id',
  },
];

const inboxNotes: InternalNote[] = [
  {
    id: 'note-1',
    entityType: 'verification',
    entityId: 'vfy-001',
    content: 'Document looks legitimate but need to verify issuer registry.',
    authorId: 'reviewer-demo',
    category: 'review',
    createdAt: new Date('2026-07-21T11:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-07-21T11:00:00.000Z').toISOString(),
  },
  {
    id: 'note-2',
    entityType: 'verification',
    entityId: 'vfy-002',
    content: 'Cross-referenced with UNHCR registry — awaiting confirmation.',
    authorId: 'reviewer-demo',
    category: 'follow_up',
    createdAt: new Date('2026-07-20T09:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-07-20T09:00:00.000Z').toISOString(),
  },
  {
    id: 'note-3',
    entityType: 'verification',
    entityId: 'vfy-002',
    content: 'Elevating to senior reviewer due to high AI risk score.',
    authorId: 'reviewer-demo',
    category: 'escalation',
    createdAt: new Date('2026-07-21T08:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-07-21T08:00:00.000Z').toISOString(),
  },
  {
    id: 'note-4',
    entityType: 'verification',
    entityId: 'vfy-003',
    content: 'All documents verified — approved by consensus.',
    authorId: 'reviewer-demo',
    category: 'review_approved',
    createdAt: new Date('2026-07-16T14:30:00.000Z').toISOString(),
    updatedAt: new Date('2026-07-16T14:30:00.000Z').toISOString(),
  },
];

function getInboxStats(): VerificationStats {
  const stats: VerificationStats = {
    pending_review: 0,
    approved: 0,
    rejected: 0,
    needs_resubmission: 0,
    total: inboxItems.length,
  };
  for (const item of inboxItems) {
    stats[item.status] += 1;
  }
  return stats;
}

// GET /v1/verification-inbox
const inboxListHandler: MockHandler = async (url) => {
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    urlObj = new URL(url, 'http://localhost');
  }

  const status = urlObj.searchParams.get('status') ?? '';
  const riskLevel = urlObj.searchParams.get('riskLevel') ?? '';
  const campaignId = urlObj.searchParams.get('campaignId') ?? '';
  const dateFrom = urlObj.searchParams.get('dateFrom') ?? '';
  const dateTo = urlObj.searchParams.get('dateTo') ?? '';
  const page = parseInt(urlObj.searchParams.get('page') ?? '1', 10) || 1;
  const limit = parseInt(urlObj.searchParams.get('limit') ?? '20', 10) || 20;

  let results = [...inboxItems];

  if (status) {
    results = results.filter(item => item.status === status);
  }
  if (riskLevel) {
    results = results.filter(item => item.riskLevel === riskLevel);
  }
  if (campaignId) {
    // In mock, ignore campaign filter since items don't have campaignId yet
    // This prevents empty results when filtering by campaign
  }
  if (dateFrom) {
    const from = new Date(dateFrom).getTime();
    results = results.filter(item => new Date(item.createdAt).getTime() >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo).getTime();
    results = results.filter(item => new Date(item.createdAt).getTime() <= to);
  }

  const total = results.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  const paged = results.slice(start, start + limit);

  const body: VerificationInboxResponse = {
    items: paged,
    total,
    page,
    limit,
    totalPages,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// GET /v1/verification-inbox/stats
const inboxStatsHandler: MockHandler = async () => {
  const stats = getInboxStats();
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
  // path: .../v1/verification-inbox/:id/approve
  const id = parts[parts.length - 2];
  const item = inboxItems.find(i => i.id === id);

  if (!item) {
    return new Response(JSON.stringify({ message: 'Verification request not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (item.status === 'approved' || item.status === 'rejected') {
    return new Response(JSON.stringify({ message: 'Verification already processed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: { nextStepMessage?: string; internalNote?: string } = {};
  if (options?.body) {
    try {
      payload = JSON.parse(options.body.toString());
    } catch { /* ignore */ }
  }

  const now = new Date().toISOString();
  item.status = 'approved';
  item.reviewedAt = now;
  item.reviewedBy = 'reviewer-demo';
  if (payload.nextStepMessage) {
    item.nextStepMessage = payload.nextStepMessage;
  }

  if (payload.internalNote) {
    inboxNotes.push({
      id: `note-${++inboxNoteCounter}`,
      entityType: 'verification',
      entityId: id,
      content: payload.internalNote,
      authorId: 'reviewer-demo',
      category: 'review_approved',
      createdAt: now,
      updatedAt: now,
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
  const id = parts[parts.length - 2];
  const item = inboxItems.find(i => i.id === id);

  if (!item) {
    return new Response(JSON.stringify({ message: 'Verification request not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (item.status === 'approved' || item.status === 'rejected') {
    return new Response(JSON.stringify({ message: 'Verification already processed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: { rejectionReason?: string; nextStepMessage?: string; internalNote?: string } = {};
  if (options?.body) {
    try {
      payload = JSON.parse(options.body.toString());
    } catch { /* ignore */ }
  }

  const now = new Date().toISOString();
  item.status = 'rejected';
  item.reviewedAt = now;
  item.reviewedBy = 'reviewer-demo';
  item.rejectionReason = payload.rejectionReason ?? null;
  if (payload.nextStepMessage) {
    item.nextStepMessage = payload.nextStepMessage;
  }

  if (payload.internalNote) {
    inboxNotes.push({
      id: `note-${++inboxNoteCounter}`,
      entityType: 'verification',
      entityId: id,
      content: payload.internalNote,
      authorId: 'reviewer-demo',
      category: 'review_rejected',
      createdAt: now,
      updatedAt: now,
    });
  }

  return new Response(JSON.stringify(item), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /v1/verification-inbox/:id/request-resubmission
const inboxResubmitHandler: MockHandler = async (url, options) => {
  const parts = url.split('?')[0].split('/');
  const id = parts[parts.length - 2];
  const item = inboxItems.find(i => i.id === id);

  if (!item) {
    return new Response(JSON.stringify({ message: 'Verification request not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (item.status === 'approved' || item.status === 'rejected') {
    return new Response(JSON.stringify({ message: 'Verification already processed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: { rejectionReason?: string; nextStepMessage?: string; internalNote?: string } = {};
  if (options?.body) {
    try {
      payload = JSON.parse(options.body.toString());
    } catch { /* ignore */ }
  }

  const now = new Date().toISOString();
  item.status = 'needs_resubmission';
  item.reviewedAt = now;
  item.reviewedBy = 'reviewer-demo';
  item.rejectionReason = payload.rejectionReason ?? null;
  if (payload.nextStepMessage) {
    item.nextStepMessage = payload.nextStepMessage;
  }

  if (payload.internalNote) {
    inboxNotes.push({
      id: `note-${++inboxNoteCounter}`,
      entityType: 'verification',
      entityId: id,
      content: payload.internalNote,
      authorId: 'reviewer-demo',
      category: 'review_needs_resubmission',
      createdAt: now,
      updatedAt: now,
    });
  }

  return new Response(JSON.stringify(item), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// GET /v1/verification-inbox/:id/notes
const inboxGetNotesHandler: MockHandler = async (url) => {
  const parts = url.split('?')[0].split('/');
  // path: .../v1/verification-inbox/:id/notes
  const id = parts[parts.length - 2];
  const item = inboxItems.find(i => i.id === id);

  if (!item) {
    return new Response(JSON.stringify({ message: 'Verification request not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const notes = inboxNotes.filter(n => n.entityId === id);
  return new Response(JSON.stringify(notes), {
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
  // Derive live totals from the in-memory mock data instead of returning
  // hard-coded zeros so that the dashboard cards display meaningful metrics.
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

export const handlers: Record<string, MockHandler> = {
  '/health': healthHandler,
  '/aid-packages': aidPackagesHandler,
  '/analytics/global-stats': dashboardSummaryHandler,
  '/recipients/import/validate': recipientsImportValidateHandler,
  '/recipients/import/confirm': recipientsImportConfirmHandler,
  '/notifications/activity-feed': activityFeedHandler,
  '/auth/webauthn/register/options': webauthnRegisterOptionsHandler,
  '/auth/webauthn/register/verify': webauthnRegisterVerifyHandler,
  '/auth/webauthn/auth/options': webauthnAuthOptionsHandler,
  '/auth/webauthn/auth/verify': webauthnAuthVerifyHandler,
  '/v1/verification-inbox': inboxListHandler,
  '/v1/verification-inbox/stats': inboxStatsHandler,
  '/v1/verification-inbox/:id': async (url, options) => {
    const method = options?.method?.toUpperCase() ?? 'GET';
    const path = url.split('?')[0];

    if (path.endsWith('/approve') && method === 'POST') {
      return inboxApproveHandler(url, options);
    }
    if (path.endsWith('/reject') && method === 'POST') {
      return inboxRejectHandler(url, options);
    }
    if (path.endsWith('/request-resubmission') && method === 'POST') {
      return inboxResubmitHandler(url, options);
    }
    if (path.endsWith('/notes') && method === 'GET') {
      return inboxGetNotesHandler(url, options);
    }
    if (path.endsWith('/notes') && method === 'POST') {
      return inboxAddNoteHandler(url, options);
    }
    if (method === 'GET') {
      return inboxDetailHandler(url, options);
    }

    return new Response(JSON.stringify({ message: 'Method not implemented in mock' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  },
  '/campaigns': async (url, options) => {
    const method = options?.method?.toUpperCase() ?? 'GET';
    if (method === 'POST') {
      return campaignCreateHandler(url, options);
    }
    return campaignsHandler(url, options);
  },
  '/campaigns/:id': async (url, options) => {
    const method = options?.method?.toUpperCase() ?? 'GET';
    if (url.split('?')[0].endsWith('/timeline')) {
      return campaignTimelineHandler(url, options);
    }
    if (method === 'PATCH') {
      return campaignUpdateHandler(url, options);
    }
    if (method === 'GET') {
      return campaignGetHandler(url, options);
    }
    return new Response(JSON.stringify({ success: false, message: 'Method not implemented in mock' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  },
};
