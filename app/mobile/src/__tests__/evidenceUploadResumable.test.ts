import AsyncStorage from '@react-native-async-storage/async-storage';
import { base64ToUint8Array, sha256Hex } from '../services/syncQueue';

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
  });
});
