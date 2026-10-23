import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  base64ToUint8Array,
  sha256Hex,
  uint8ArrayToBase64,
} from '../services/syncQueue';

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

type SyncQueueModule = typeof import('../services/syncQueue');

const loadFreshQueue = (): SyncQueueModule => {
  let mod!: SyncQueueModule;
  jest.isolateModules(() => {
    mod = require('../services/syncQueue') as SyncQueueModule;
  });
  return mod;
};

describe('Resumable Evidence Upload Chunks', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockFetch.mockReset();
  });

  describe('base64ToUint8Array', () => {
    it('decodes simple base64 strings correctly', () => {
      const base64 = 'SGVsbG8gV29ybGQ='; // "Hello World"
      const result = base64ToUint8Array(base64);
      expect(new TextDecoder().decode(result)).toBe('Hello World');
    });

    it('handles base64 data URLs', () => {
      const dataUrl = 'data:image/jpeg;base64,SGVsbG8gV29ybGQ=';
      const result = base64ToUint8Array(dataUrl);
      expect(new TextDecoder().decode(result)).toBe('Hello World');
    });

    it('ignores whitespaces', () => {
      const spaced = 'SGVsbG8g V29ybGQ=\n';
      const result = base64ToUint8Array(spaced);
      expect(new TextDecoder().decode(result)).toBe('Hello World');
    });
  });

  describe('sha256Hex', () => {
    it('calculates standard SHA-256 hash', async () => {
      const data = new TextEncoder().encode('Hello World');
      const hash = await sha256Hex(data);
      // SHA-256 for "Hello World"
      expect(hash).toBe('a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e');
    });

    it('still digests when the platform has no crypto.subtle', async () => {
      // A React Native release bundle has no `crypto.subtle`, which is what
      // made every chunk upload fail on device with "WebCrypto subtle is not
      // available". Removing it must not change the digest.
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        configurable: true,
      });

      try {
        const hash = await sha256Hex(new TextEncoder().encode('Hello World'));
        expect(hash).toBe(
          'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
        );
      } finally {
        if (descriptor) {
          Object.defineProperty(globalThis, 'crypto', descriptor);
        } else {
          delete (globalThis as { crypto?: unknown }).crypto;
        }
      }
    });
  });

  describe('uint8ArrayToBase64', () => {
    it('produces standard padded base64 for every remainder length', () => {
      expect(uint8ArrayToBase64(new Uint8Array([]))).toBe('');
      expect(uint8ArrayToBase64(new TextEncoder().encode('Hello World'))).toBe(
        'SGVsbG8gV29ybGQ=',
      );
      expect(uint8ArrayToBase64(new Uint8Array([0]))).toBe('AA==');
      expect(uint8ArrayToBase64(new Uint8Array([0, 0]))).toBe('AAA=');
      expect(uint8ArrayToBase64(new Uint8Array([0, 0, 0]))).toBe('AAAA');
      expect(uint8ArrayToBase64(new Uint8Array([251, 255, 190, 1]))).toBe(
        '+/++AQ==',
      );
    });

    it('round-trips arbitrary bytes (the chunk upload path)', () => {
      const bytes = new Uint8Array(1021);
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = (i * 31 + 7) % 256;
      }

      expect(uint8ArrayToBase64(bytes)).toBe(
        Buffer.from(bytes).toString('base64'),
      );
      expect(Array.from(base64ToUint8Array(uint8ArrayToBase64(bytes)))).toEqual(
        Array.from(bytes),
      );
    });
  });

  describe('Resumable Chunk Upload Session', () => {
    it('creates a new session and uploads all chunks sequentially', async () => {
      const { dispatchNetworkAction, flushPendingNetworkActions, getSyncQueueState } = loadFreshQueue();

      // Enqueue a mock evidence upload
      const requestPayload = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        imageBase64: 'SGVsbG8gV29ybGQ=', // "Hello World" (11 bytes)
      };

      await dispatchNetworkAction(
        {
          type: 'evidence-upload',
          payload: {
            aidId: 'aid-abc',
            url: 'http://localhost:3000/api/v1/verification/upload',
            body: JSON.stringify(requestPayload),
          },
        },
        { online: false }
      );

      // Mock create session
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'session-123',
          fileName: 'test.jpg',
          mimeType: 'image/jpeg',
          totalSize: 11,
          chunkSize: 524288,
          totalChunks: 1,
        }),
      });

      // Mock upload chunk 0
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'session-123',
          index: 0,
          received: true,
          duplicate: false,
        }),
      });

      // Mock finalize
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'ev-item-999',
          fileName: 'test.jpg',
          status: 'pending',
        }),
      });

      // Flush queue
      await flushPendingNetworkActions({ online: true });

      // Verify fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
      
      // Verify first call was POST to /upload-sessions
      expect(mockFetch.mock.calls[0][0]).toContain('/evidence/upload-sessions');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');

      // Verify second call was POST to /chunks
      expect(mockFetch.mock.calls[1][0]).toContain('/evidence/upload-sessions/session-123/chunks');
      
      // Verify third call was POST to /finalize
      expect(mockFetch.mock.calls[2][0]).toContain('/evidence/upload-sessions/session-123/finalize');

      // Check queue state
      const state = await getSyncQueueState();
      expect(state.items).toHaveLength(0); // Finished action is removed from queue
    });

    it('resumes from existing session and only uploads missing chunks', async () => {
      const { flushPendingNetworkActions, getSyncQueueState } = loadFreshQueue();

      const requestPayload = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        imageBase64: 'SGVsbG8gV29ybGQ=', 
      };

      // Seed queue with an action that already has a sessionId and 3 chunks
      const seededAction = {
        id: 'action-resumable',
        type: 'evidence-upload',
        payload: {
          aidId: 'aid-abc',
          url: 'http://localhost:3000/api/v1/verification/upload',
          body: JSON.stringify(requestPayload),
          sessionId: 'session-resumable',
          totalChunks: 3,
          uploadedChunks: [0], // Chunk 0 already uploaded locally
          progress: 0.33,
        },
        state: 'pending',
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastError: null,
      };

      await AsyncStorage.setItem('@soter/sync-queue', JSON.stringify([seededAction]));

      // Mock status check: returns that chunk 0 and 2 are uploaded on backend, chunk 1 is missing
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'session-resumable',
          totalChunks: 3,
          receivedChunks: [0, 2], // Only chunk 1 is missing
        }),
      });

      // Mock upload chunk 1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'session-resumable',
          index: 1,
          received: true,
          duplicate: false,
        }),
      });

      // Mock finalize
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'ev-item-resumed',
          fileName: 'test.jpg',
          status: 'pending',
        }),
      });

      // Flush queue
      await flushPendingNetworkActions({ online: true });

      // Verify fetch calls:
      // 1. GET status
      // 2. POST chunk 1
      // 3. POST finalize
      expect(mockFetch).toHaveBeenCalledTimes(3);

      expect(mockFetch.mock.calls[0][0]).toContain('/evidence/upload-sessions/session-resumable/status');
      expect(mockFetch.mock.calls[1][0]).toContain('/evidence/upload-sessions/session-resumable/chunks');
      
      const formData = mockFetch.mock.calls[1][1].body as FormData;
      expect(formData.get('index')).toBe('1');

      expect(mockFetch.mock.calls[2][0]).toContain('/evidence/upload-sessions/session-resumable/finalize');

      const state = await getSyncQueueState();
      expect(state.items).toHaveLength(0);
    });

    it('resumes after network-type change (WiFi → cellular) mid-upload without restarting from chunk 0', async () => {
      // This is the core acceptance criterion: a WiFi→cellular switch happens
      // while uploading chunk 1 of 3.  The OS tears down the socket, the fetch
      // for chunk 1 rejects, and the action lands in "retrying" state with
      // sessionId and uploadedChunks=[0] persisted.  On the next flush the
      // queue must query /status (not create a new session) and upload only the
      // missing chunks.
      const { flushPendingNetworkActions, getSyncQueueState } = loadFreshQueue();

      const requestPayload = {
        filename: 'large-video.mp4',
        contentType: 'video/mp4',
        // Represent a multi-chunk file; content doesn't matter for routing logic
        imageBase64: 'SGVsbG8gV29ybGQ=',
      };

      // Action is in 'retrying' state with chunk 0 already uploaded before the
      // network change interrupted the upload of chunk 1.
      const interruptedAction = {
        id: 'action-network-change',
        type: 'evidence-upload',
        payload: {
          aidId: 'aid-xyz',
          url: 'http://localhost:3000/api/v1/verification/upload',
          body: JSON.stringify(requestPayload),
          sessionId: 'session-mid-upload',
          totalChunks: 3,
          uploadedChunks: [0], // Chunk 0 was committed before the switch
          progress: 0.33,
        },
        state: 'retrying', // Set by flushPendingNetworkActions when the chunk fetch threw
        retryCount: 1,
        maxRetries: 5,
        nextRetryAt: new Date(Date.now() - 1000).toISOString(), // due immediately
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastError: 'Network request failed', // typical fetch error on interface change
      };

      await AsyncStorage.setItem('@soter/sync-queue', JSON.stringify([interruptedAction]));

      // Step 1: GET /status — server confirms chunk 0 received, chunks 1 & 2 missing
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'session-mid-upload',
          totalChunks: 3,
          receivedChunks: [0],
        }),
      });

      // Step 2: POST chunk 1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 'session-mid-upload', index: 1, received: true, duplicate: false }),
      });

      // Step 3: POST chunk 2
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 'session-mid-upload', index: 2, received: true, duplicate: false }),
      });

      // Step 4: POST /finalize
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ev-item-network-change', fileName: 'large-video.mp4', status: 'pending' }),
      });

      // Simulate what SyncContext.handleNetworkChange does: flush with online=true
      await flushPendingNetworkActions({ online: true });

      // Must NOT have called POST /evidence/upload-sessions (that would be a restart)
      const sessionCreateCalls = mockFetch.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].endsWith('/evidence/upload-sessions') &&
          call[1]?.method === 'POST',
      );
      expect(sessionCreateCalls).toHaveLength(0); // No new session created

      // Must have queried /status first (resume path)
      expect(mockFetch.mock.calls[0][0]).toContain('/evidence/upload-sessions/session-mid-upload/status');

      // Uploaded exactly chunks 1 and 2 (chunk 0 was already on server)
      const chunkCalls = mockFetch.mock.calls.filter((call) =>
        typeof call[0] === 'string' &&
        call[0].includes('/chunks'),
      );
      expect(chunkCalls).toHaveLength(2);

      const uploadedIndices = chunkCalls.map((call) => {
        const fd = call[1].body as FormData;
        return fd.get('index');
      });
      expect(uploadedIndices).toEqual(['1', '2']);

      // Finalized with the existing session
      expect(mockFetch.mock.calls[3][0]).toContain('/evidence/upload-sessions/session-mid-upload/finalize');

      // Action removed from queue after successful completion
      const finalState = await getSyncQueueState();
      expect(finalState.items).toHaveLength(0);

      // Total fetch calls: 1 status + 2 chunks + 1 finalize = 4
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('falls back to a new session when the existing session has expired (404 on status)', async () => {
      // If the server-side session expired (e.g. upload was dormant for >24h),
      // the mobile client must create a new session and restart from chunk 0
      // rather than hanging on an unknown sessionId.
      const { flushPendingNetworkActions, getSyncQueueState } = loadFreshQueue();

      const requestPayload = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        imageBase64: 'SGVsbG8gV29ybGQ=',
      };

      const staleAction = {
        id: 'action-stale-session',
        type: 'evidence-upload',
        payload: {
          aidId: 'aid-stale',
          url: 'http://localhost:3000/api/v1/verification/upload',
          body: JSON.stringify(requestPayload),
          sessionId: 'session-expired',
          totalChunks: 1,
          uploadedChunks: [0],
          progress: 1.0,
        },
        state: 'retrying',
        retryCount: 1,
        maxRetries: 5,
        nextRetryAt: new Date(Date.now() - 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastError: 'Network request failed',
      };

      await AsyncStorage.setItem('@soter/sync-queue', JSON.stringify([staleAction]));

      // Status returns 404 — session expired
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Upload session not found' }),
      });

      // New session creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'session-new',
          totalChunks: 1,
          chunkSize: 524288,
        }),
      });

      // Upload chunk 0
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 'session-new', index: 0, received: true, duplicate: false }),
      });

      // Finalize
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ev-item-new', fileName: 'test.jpg', status: 'pending' }),
      });

      await flushPendingNetworkActions({ online: true });

      // status → new session → chunk 0 → finalize = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // New session was created
      const sessionCreateCall = mockFetch.mock.calls[1];
      expect(sessionCreateCall[0]).toContain('/evidence/upload-sessions');
      expect(sessionCreateCall[1].method).toBe('POST');

      const finalState = await getSyncQueueState();
      expect(finalState.items).toHaveLength(0);
    });
  });
});
