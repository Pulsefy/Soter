import { Test, TestingModule } from '@nestjs/testing';
import { MessageEvent } from '@nestjs/common';

import {
  VerificationInboxSseService,
} from './verification-inbox-sse.service';

describe('VerificationInboxSseService', () => {
  let service: VerificationInboxSseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VerificationInboxSseService],
    }).compile();

    service = module.get<VerificationInboxSseService>(
      VerificationInboxSseService,
    );
  });

  afterEach(() => {
    // Complete the bus so subscriptions clean up after each test
    service.onModuleDestroy();
  });

  // ───────────────────────────────────────────────────────────────
  // buildStatusEvent — message shape
  // ───────────────────────────────────────────────────────────────

  describe('buildStatusEvent()', () => {
    it('builds a status_updated event with required fields', () => {
      const event = service.buildStatusEvent(
        'v1',
        'pending_review',
        'approved',
        'reviewer-1',
      );

      expect(event.type).toBe('status_updated');
      expect(event.verificationId).toBe('v1');
      expect(event.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      expect(event.data).toMatchObject({
        previousStatus: 'pending_review',
        newStatus: 'approved',
        reviewerId: 'reviewer-1',
      });
    });

    it('includes rejectionReason and nextStepMessage when provided', () => {
      const event = service.buildStatusEvent(
        'v2',
        'pending_review',
        'rejected',
        'reviewer-2',
        'Document expired',
        'Please resubmit',
      );

      expect(event.data).toMatchObject({
        rejectionReason: 'Document expired',
        nextStepMessage: 'Please resubmit',
      });
    });

    it('omits rejectionReason and nextStepMessage when not provided', () => {
      const event = service.buildStatusEvent(
        'v3',
        'pending_review',
        'approved',
        'reviewer-3',
      );

      expect(event.data).not.toHaveProperty('rejectionReason');
      expect(event.data).not.toHaveProperty('nextStepMessage');
    });

    it('omits optional fields when null is passed', () => {
      const event = service.buildStatusEvent(
        'v4',
        'pending_review',
        'approved',
        'reviewer-4',
        null,
        null,
      );

      // null treated same as undefined — fields should not appear
      expect(event.data).not.toHaveProperty('rejectionReason');
      expect(event.data).not.toHaveProperty('nextStepMessage');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // buildNoteEvent — message shape
  // ───────────────────────────────────────────────────────────────

  describe('buildNoteEvent()', () => {
    it('builds a note_added event with required fields', () => {
      const event = service.buildNoteEvent('v1', 'note-1', 'author-1', null);

      expect(event.type).toBe('note_added');
      expect(event.verificationId).toBe('v1');
      expect(event.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      expect(event.data).toMatchObject({
        noteId: 'note-1',
        authorId: 'author-1',
      });
      expect(event.data).not.toHaveProperty('category');
    });

    it('includes category when provided', () => {
      const event = service.buildNoteEvent(
        'v1',
        'note-2',
        'author-1',
        'follow_up',
      );

      expect(event.data).toMatchObject({ category: 'follow_up' });
    });
  });

  // ───────────────────────────────────────────────────────────────
  // emit() + getStream() — message delivery
  // ───────────────────────────────────────────────────────────────

  describe('getStream() / emit()', () => {
    it('delivers emitted events to a global subscriber as MessageEvent', done => {
      const stream$ = service.getStream();
      const received: MessageEvent[] = [];

      const subscription = stream$.subscribe({
        next: msg => {
          received.push(msg);
          if (received.length === 1) {
            subscription.unsubscribe();

            const parsed = JSON.parse(msg.data as string) as Record<
              string,
              unknown
            >;
            expect(msg.type).toBe('status_updated');
            expect(msg.id).toMatch(/^v1-/);
            expect(parsed['verificationId']).toBe('v1');
            expect(parsed['newStatus']).toBe('approved');
            done();
          }
        },
        error: done,
      });

      service.emit(
        service.buildStatusEvent('v1', 'pending_review', 'approved', 'r-1'),
      );
    });

    it('delivers emitted events to multiple independent subscribers', done => {
      const results: string[] = [];
      let completed = 0;

      function checkDone() {
        completed++;
        if (completed === 2) {
          expect(results).toHaveLength(2);
          done();
        }
      }

      const s1 = service.getStream().subscribe(msg => {
        results.push(`s1-${(JSON.parse(msg.data as string) as { verificationId: string }).verificationId}`);
        s1.unsubscribe();
        checkDone();
      });

      const s2 = service.getStream().subscribe(msg => {
        results.push(`s2-${(JSON.parse(msg.data as string) as { verificationId: string }).verificationId}`);
        s2.unsubscribe();
        checkDone();
      });

      service.emit(
        service.buildStatusEvent('v-multi', 'pending_review', 'approved', 'r-1'),
      );
    });

    it('scoped stream only receives events for the given verificationId', done => {
      const received: MessageEvent[] = [];

      const sub = service.getStream('v-target').subscribe(msg => {
        received.push(msg);
        if (received.length === 1) {
          sub.unsubscribe();
          const parsed = JSON.parse(msg.data as string) as { verificationId: string };
          expect(parsed.verificationId).toBe('v-target');
          expect(received).toHaveLength(1);
          done();
        }
      });

      // This should NOT reach the scoped subscriber.
      service.emit(
        service.buildStatusEvent('v-other', 'pending_review', 'approved', 'r-1'),
      );

      // This SHOULD reach the scoped subscriber.
      service.emit(
        service.buildStatusEvent('v-target', 'pending_review', 'approved', 'r-2'),
      );
    });

    it('delivers note_added events with correct shape', done => {
      const sub = service.getStream().subscribe(msg => {
        sub.unsubscribe();
        const parsed = JSON.parse(msg.data as string) as Record<string, unknown>;
        expect(msg.type).toBe('note_added');
        expect(parsed['noteId']).toBe('note-99');
        expect(parsed['authorId']).toBe('author-x');
        done();
      });

      service.emit(
        service.buildNoteEvent('v1', 'note-99', 'author-x', 'follow_up'),
      );
    });

    it('carries a unique event id composed of verificationId and timestamp', done => {
      const sub = service.getStream().subscribe(msg => {
        sub.unsubscribe();
        expect(typeof msg.id).toBe('string');
        expect((msg.id as string).startsWith('v-id-test-')).toBe(true);
        done();
      });

      service.emit(
        service.buildStatusEvent('v-id-test', 'pending_review', 'approved', 'r-1'),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Connection lifecycle
  // ───────────────────────────────────────────────────────────────

  describe('connection lifecycle', () => {
    it('increments connection count when a stream is opened', () => {
      expect(service.getConnectionCount()).toBe(0);

      const sub1 = service.getStream().subscribe(() => {});
      expect(service.getConnectionCount()).toBe(1);

      const sub2 = service.getStream('v1').subscribe(() => {});
      expect(service.getConnectionCount()).toBe(2);

      sub1.unsubscribe();
      sub2.unsubscribe();
    });

    it('decrements connection count when a subscription is unsubscribed', () => {
      const sub = service.getStream().subscribe(() => {});
      expect(service.getConnectionCount()).toBe(1);

      sub.unsubscribe();
      expect(service.getConnectionCount()).toBe(0);
    });

    it('connection count never goes below zero', () => {
      const sub = service.getStream().subscribe(() => {});
      sub.unsubscribe();
      sub.unsubscribe(); // double-unsubscribe
      expect(service.getConnectionCount()).toBe(0);
    });

    it('completes the event bus on module destroy', done => {
      const sub = service.getStream().subscribe({
        complete: () => {
          done();
        },
      });

      service.onModuleDestroy();

      // Prevent double-teardown in afterEach
      sub.unsubscribe();
    });

    it('new subscriptions after module destroy receive no events', () => {
      service.onModuleDestroy();

      const received: unknown[] = [];
      // Subscribing to a completed Subject is a no-op in terms of next.
      service.getStream().subscribe({ next: v => received.push(v) });

      service.emit(
        service.buildStatusEvent('v1', 'pending_review', 'approved', 'r-1'),
      );

      expect(received).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Reconnect behaviour (simulated)
  // ───────────────────────────────────────────────────────────────

  describe('reconnect behaviour', () => {
    it('a re-opened stream receives new events emitted after reconnect', done => {
      // First connection — connect then disconnect.
      const firstSub = service.getStream().subscribe(() => {});
      firstSub.unsubscribe();

      // Emit an event while disconnected — should NOT be buffered.
      service.emit(
        service.buildStatusEvent('v-reconnect', 'pending_review', 'approved', 'r-1'),
      );

      // Second connection — reconnect.
      const received: string[] = [];
      const secondSub = service.getStream().subscribe(msg => {
        received.push(msg.type as string);
        if (received.length === 1) {
          secondSub.unsubscribe();
          expect(received[0]).toBe('note_added');
          done();
        }
      });

      // Only events emitted AFTER reconnect are visible — no replay.
      service.emit(service.buildNoteEvent('v-reconnect', 'note-1', 'r-2', null));
    });
  });
});
