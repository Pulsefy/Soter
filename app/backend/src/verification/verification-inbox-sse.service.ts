import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { MessageEvent } from '@nestjs/common';

/** The set of event types that can be streamed to reviewers. */
export type InboxEventType = 'status_updated' | 'note_added';

/** Payload streamed over SSE for every inbox mutation. */
export interface InboxSseEvent {
  /** The type of mutation that occurred. */
  type: InboxEventType;
  /** The verification request ID that was mutated. */
  verificationId: string;
  /** ISO-8601 timestamp of when the event was emitted. */
  timestamp: string;
  /** Additional event-specific data. */
  data: Record<string, unknown>;
}

/**
 * Manages SSE connections for the verification inbox and emits real-time
 * events whenever queue items or review state change.
 *
 * Architecture:
 * - A single RxJS Subject acts as the internal event bus.
 * - Each SSE connection subscribes to a filtered view of that bus.
 * - Connections are tracked for observability; they are torn down by the
 *   client disconnecting (the HTTP response stream closes) — no manual
 *   cleanup is required at the service level.
 */
@Injectable()
export class VerificationInboxSseService implements OnModuleDestroy {
  /** Internal event bus. All mutations are pushed here. */
  private readonly eventBus$ = new Subject<InboxSseEvent>();

  /** Number of currently-open SSE connections (for observability). */
  private connectionCount = 0;

  /**
   * Push a new event onto the internal bus so all active subscribers
   * receive it immediately.
   */
  emit(event: InboxSseEvent): void {
    this.eventBus$.next(event);
  }

  /**
   * Returns an Observable<MessageEvent> for a single SSE connection.
   *
   * @param verificationId  When provided, the stream is scoped to mutations
   *                        for that specific verification request only.
   *                        When omitted, all inbox mutations are streamed.
   */
  getStream(verificationId?: string): Observable<MessageEvent> {
    this.connectionCount++;

    const source$ = verificationId
      ? this.eventBus$.pipe(filter(e => e.verificationId === verificationId))
      : this.eventBus$.asObservable();

    return new Observable<MessageEvent>(observer => {
      const subscription = source$.subscribe({
        next: (event: InboxSseEvent) => {
          const message: MessageEvent = {
            type: event.type,
            data: JSON.stringify({
              verificationId: event.verificationId,
              timestamp: event.timestamp,
              ...event.data,
            }),
            id: `${event.verificationId}-${event.timestamp}`,
            retry: undefined,
          };
          observer.next(message);
        },
        error: (err: unknown) => observer.error(err),
        // Forward Subject completion (e.g. on module destroy) to the observer.
        complete: () => observer.complete(),
      });

      // Teardown: called when the client disconnects or the controller
      // unsubscribes (e.g. test cleanup).
      return () => {
        subscription.unsubscribe();
        this.connectionCount = Math.max(0, this.connectionCount - 1);
      };
    });
  }

  /** Returns the current number of open SSE connections. */
  getConnectionCount(): number {
    return this.connectionCount;
  }

  /** Build a well-typed status_updated event payload. */
  buildStatusEvent(
    verificationId: string,
    previousStatus: string,
    newStatus: string,
    reviewerId: string,
    rejectionReason?: string | null,
    nextStepMessage?: string | null,
  ): InboxSseEvent {
    return {
      type: 'status_updated',
      verificationId,
      timestamp: new Date().toISOString(),
      data: {
        previousStatus,
        newStatus,
        reviewerId,
        ...(rejectionReason != null ? { rejectionReason } : {}),
        ...(nextStepMessage != null ? { nextStepMessage } : {}),
      },
    };
  }

  /** Build a well-typed note_added event payload. */
  buildNoteEvent(
    verificationId: string,
    noteId: string,
    authorId: string,
    category: string | null,
  ): InboxSseEvent {
    return {
      type: 'note_added',
      verificationId,
      timestamp: new Date().toISOString(),
      data: {
        noteId,
        authorId,
        ...(category != null ? { category } : {}),
      },
    };
  }

  /** Gracefully complete the event bus on module teardown. */
  onModuleDestroy(): void {
    this.eventBus$.complete();
  }
}
