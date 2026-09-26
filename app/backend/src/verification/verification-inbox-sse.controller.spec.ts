import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { filter, firstValueFrom, take } from 'rxjs';
import {
  VerificationInboxEventPayload,
  VerificationInboxEventsService,
} from './verification-inbox-events.service';
import {
  INBOX_HEARTBEAT_EVENT,
  VerificationInboxSseController,
} from './verification-inbox-sse.controller';

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

const reviewer = { user: { sub: 'reviewer-1' } };

describe('VerificationInboxSseController', () => {
  let controller: VerificationInboxSseController;
  let events: VerificationInboxEventsService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [VerificationInboxSseController],
      providers: [
        VerificationInboxEventsService,
        {
          provide: ConfigService,
          // Short heartbeat so the keep-alive assertion stays fast.
          useValue: { get: jest.fn().mockReturnValue('5') },
        },
      ],
    }).compile();

    controller = moduleRef.get(VerificationInboxSseController);
    events = moduleRef.get(VerificationInboxEventsService);
  });

  it('rejects unauthenticated connections', () => {
    expect(() => controller.stream({})).toThrow(UnauthorizedException);
    expect(() => controller.stream({ user: null })).toThrow(
      UnauthorizedException,
    );
  });

  it('emits review updates as SSE messages with id, type and JSON data', async () => {
    const received = firstValueFrom(
      controller.stream(reviewer).pipe(
        filter(message => message.type !== INBOX_HEARTBEAT_EVENT),
        take(1),
      ),
    );

    events.publish('inbox.item.updated', payload('ver-1'));

    const message = await received;

    expect(message.id).toBe('1');
    expect(message.type).toBe('inbox.item.updated');
    expect(message.data).toEqual({
      eventId: 1,
      emittedAt: expect.any(String),
      ...payload('ver-1'),
    });
  });

  it('emits queue mutations as well as review decisions', async () => {
    const received = firstValueFrom(
      controller.stream(reviewer).pipe(
        filter(message => message.type !== INBOX_HEARTBEAT_EVENT),
        take(1),
      ),
    );

    events.publish('inbox.queue.changed', payload('ver-9', 'pending_review'));

    await expect(received).resolves.toMatchObject({
      type: 'inbox.queue.changed',
    });
  });

  it('replays missed events when a client reconnects with Last-Event-ID', async () => {
    events.publish('inbox.item.updated', payload('ver-1'));
    events.publish('inbox.item.updated', payload('ver-2'));

    const message = await firstValueFrom(
      controller.stream(reviewer, '1').pipe(
        filter(item => item.type !== INBOX_HEARTBEAT_EVENT),
        take(1),
      ),
    );

    expect(message.id).toBe('2');
    expect(message.data).toMatchObject({ verificationId: 'ver-2' });
  });

  it('accepts lastEventId as a query fallback and ignores invalid values', async () => {
    events.publish('inbox.item.updated', payload('ver-1'));

    const viaQuery = await firstValueFrom(
      controller.stream(reviewer, undefined, '0').pipe(
        filter(item => item.type !== INBOX_HEARTBEAT_EVENT),
        take(1),
      ),
    );

    expect(viaQuery.data).toMatchObject({ verificationId: 'ver-1' });
  });

  it('restricts a connection to the requested statuses', async () => {
    const received = firstValueFrom(
      controller.stream(reviewer, undefined, undefined, 'approved').pipe(
        filter(message => message.type !== INBOX_HEARTBEAT_EVENT),
        take(1),
      ),
    );

    events.publish('inbox.item.updated', payload('ver-1', 'rejected'));
    events.publish('inbox.item.updated', payload('ver-2', 'approved'));

    await expect(received).resolves.toMatchObject({
      data: expect.objectContaining({ verificationId: 'ver-2' }),
    });
  });

  it('sends heartbeats so idle connections stay open', async () => {
    const heartbeat = await firstValueFrom(
      controller.stream(reviewer).pipe(
        filter(message => message.type === INBOX_HEARTBEAT_EVENT),
        take(1),
      ),
    );

    expect(heartbeat.data).toMatchObject({ reviewerId: 'reviewer-1' });
  });
});
