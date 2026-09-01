import { Test, TestingModule } from '@nestjs/testing';
import { firstValueFrom, take, toArray } from 'rxjs';
import {
  REPLAY_BUFFER_LIMIT,
  VerificationInboxEventPayload,
  VerificationInboxEventsService,
} from './verification-inbox-events.service';

const payload = (
  id: string,
  status = 'approved',
): VerificationInboxEventPayload => ({
  verificationId: id,
  status,
  previousStatus: 'pending_review',
  reviewedBy: 'reviewer-1',
  reviewedAt: '2026-01-01T00:00:00.000Z',
  deepLink: `/verification/${id}`,
});

describe('VerificationInboxEventsService', () => {
  let service: VerificationInboxEventsService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [VerificationInboxEventsService],
    }).compile();

    service = moduleRef.get(VerificationInboxEventsService);
  });

  it('publishes events with monotonic ids and a stable shape', () => {
    const first = service.publish('inbox.item.updated', payload('v1'));
    const second = service.publish(
      'inbox.queue.changed',
      payload('v2', 'pending_review'),
    );

    expect(first).toEqual({
      id: 1,
      type: 'inbox.item.updated',
      emittedAt: expect.any(String),
      payload: payload('v1'),
    });
    expect(second.id).toBe(2);
    expect(service.lastEventId).toBe(2);
  });

  it('delivers live events to an attached subscriber', async () => {
    const received = firstValueFrom(service.subscribe().pipe(take(1)));

    service.publish('inbox.item.updated', payload('v1'));

    await expect(received).resolves.toMatchObject({
      id: 1,
      type: 'inbox.item.updated',
    });
  });

  it('replays only the events missed while disconnected', async () => {
    service.publish('inbox.item.updated', payload('v1'));
    service.publish('inbox.item.updated', payload('v2'));
    service.publish('inbox.item.updated', payload('v3'));

    const replayed = await firstValueFrom(
      service.subscribe({ lastEventId: 1 }).pipe(take(2), toArray()),
    );

    expect(replayed.map(event => event.payload.verificationId)).toEqual([
      'v2',
      'v3',
    ]);
  });

  it('returns nothing to replay when the client is already current', () => {
    service.publish('inbox.item.updated', payload('v1'));

    expect(service.replay({ lastEventId: service.lastEventId })).toEqual([]);
  });

  it('scopes the stream to the requested statuses', async () => {
    const received = firstValueFrom(
      service.subscribe({ statuses: ['approved'] }).pipe(take(1)),
    );

    service.publish('inbox.item.updated', payload('v1', 'rejected'));
    service.publish('inbox.item.updated', payload('v2', 'approved'));

    const event = await received;

    expect(event.payload.verificationId).toBe('v2');
  });

  it('caps the replay buffer so memory cannot grow without bound', () => {
    for (let i = 1; i <= REPLAY_BUFFER_LIMIT + 10; i += 1) {
      service.publish('inbox.item.updated', payload(`v${i}`));
    }

    const buffered = service.replay();

    expect(buffered).toHaveLength(REPLAY_BUFFER_LIMIT);
    expect(buffered[0].id).toBe(11);
    expect(service.lastEventId).toBe(REPLAY_BUFFER_LIMIT + 10);
  });
});
