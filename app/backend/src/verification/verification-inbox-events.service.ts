import { Injectable } from '@nestjs/common';
import { Observable, Subject, concat, from } from 'rxjs';
import { filter } from 'rxjs/operators';

/**
 * Event kinds published on the verification inbox stream.
 *
 * - `inbox.queue.changed` - the review queue itself mutated (item enqueued,
 *   requeued, or removed from the queue).
 * - `inbox.item.updated` - a review decision landed on a single item.
 */
export type VerificationInboxEventType =
  'inbox.queue.changed' | 'inbox.item.updated';

export interface VerificationInboxEventPayload {
  verificationId: string;
  status: string;
  previousStatus: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  deepLink: string;
}

export interface VerificationInboxEvent {
  id: number;
  type: VerificationInboxEventType;
  emittedAt: string;
  payload: VerificationInboxEventPayload;
}

export interface VerificationInboxStreamOptions {
  /** Only deliver events whose payload status is in this list. */
  statuses?: string[];
  /** Last event id the client already received, for reconnect replay. */
  lastEventId?: number | null;
}

/**
 * Number of recent events retained in memory so a client that reconnects with
 * `Last-Event-ID` can be caught up without a full inbox refetch.
 */
export const REPLAY_BUFFER_LIMIT = 200;

/**
 * In-process fan-out hub for verification inbox activity.
 *
 * Producers (the inbox service) call {@link publish}; the SSE controller calls
 * {@link subscribe} once per connected reviewer. Event ids are monotonic within
 * the process lifetime, which is what makes `Last-Event-ID` replay meaningful.
 */
@Injectable()
export class VerificationInboxEventsService {
  private sequence = 0;
  private readonly recent: VerificationInboxEvent[] = [];
  private readonly events$ = new Subject<VerificationInboxEvent>();

  /** Highest event id published so far. */
  get lastEventId(): number {
    return this.sequence;
  }

  publish(
    type: VerificationInboxEventType,
    payload: VerificationInboxEventPayload,
  ): VerificationInboxEvent {
    this.sequence += 1;

    const event: VerificationInboxEvent = {
      id: this.sequence,
      type,
      emittedAt: new Date().toISOString(),
      payload,
    };

    this.recent.push(event);
    if (this.recent.length > REPLAY_BUFFER_LIMIT) {
      this.recent.splice(0, this.recent.length - REPLAY_BUFFER_LIMIT);
    }

    this.events$.next(event);

    return event;
  }

  /** Buffered events the client missed, oldest first. */
  replay(
    options: VerificationInboxStreamOptions = {},
  ): VerificationInboxEvent[] {
    const lastEventId = options.lastEventId ?? 0;

    return this.recent.filter(
      event =>
        event.id > lastEventId && this.isInScope(event, options.statuses),
    );
  }

  /**
   * Replayed events (if the client sent a `Last-Event-ID`) followed by the live
   * feed, both filtered to the caller's scope.
   */
  subscribe(
    options: VerificationInboxStreamOptions = {},
  ): Observable<VerificationInboxEvent> {
    const live$ = this.events$.pipe(
      filter(event => this.isInScope(event, options.statuses)),
    );

    const missed = this.replay(options);
    if (missed.length === 0) {
      return live$;
    }

    return concat(from(missed), live$);
  }

  private isInScope(
    event: VerificationInboxEvent,
    statuses?: string[],
  ): boolean {
    if (!statuses || statuses.length === 0) {
      return true;
    }

    return statuses.includes(event.payload.status);
  }
}
