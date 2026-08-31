import {
  Controller,
  Headers,
  MessageEvent,
  Query,
  Req,
  Sse,
  UnauthorizedException,
  Version,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Observable, interval, map, merge } from 'rxjs';
import { AppRole } from '../auth/app-role.enum';
import { Roles } from '../auth/roles.decorator';
import {
  VerificationInboxEvent,
  VerificationInboxEventsService,
} from './verification-inbox-events.service';

/** Comment-only keep-alive frame so idle proxies do not drop the connection. */
export const INBOX_HEARTBEAT_EVENT = 'inbox.heartbeat';

export const DEFAULT_HEARTBEAT_MS = 25000;

interface AuthenticatedInboxRequest {
  user?: { sub?: string; apiKeyId?: string } | null;
}

/**
 * Server-Sent Events feed for the verification review inbox.
 *
 * The connection is authenticated by the global API key guard (which populates
 * `request.user`) and additionally restricted to operator/admin reviewers. Each
 * connection may narrow its scope with `?status=`, and may resume after a drop
 * with the standard `Last-Event-ID` header (or `?lastEventId=`).
 */
@ApiTags('Verification Inbox')
@ApiBearerAuth('JWT-auth')
@Controller('verification-inbox')
export class VerificationInboxSseController {
  constructor(
    private readonly events: VerificationInboxEventsService,
    private readonly config: ConfigService,
  ) {}

  @Sse('stream')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    summary: 'Stream inbox queue mutations and review updates over SSE',
    description:
      'Long-lived SSE stream. Each message carries an incrementing id, an ' +
      'event type (inbox.queue.changed, inbox.item.updated or ' +
      'inbox.heartbeat) and a JSON payload. Reconnect with the Last-Event-ID ' +
      'header to replay only the events missed while disconnected.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Comma separated statuses to restrict the stream to.',
  })
  @ApiQuery({
    name: 'lastEventId',
    required: false,
    description:
      'Fallback for clients that cannot set the Last-Event-ID header.',
  })
  @ApiUnauthorizedResponse({ description: 'No authenticated reviewer.' })
  stream(
    @Req() req: AuthenticatedInboxRequest,
    @Headers('last-event-id') lastEventIdHeader?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
    @Query('status') status?: string,
  ): Observable<MessageEvent> {
    const reviewerId = req.user?.apiKeyId ?? req.user?.sub;
    if (!reviewerId) {
      throw new UnauthorizedException(
        'An authenticated reviewer is required to stream the inbox',
      );
    }

    const updates$ = this.events
      .subscribe({
        statuses: this.parseStatuses(status),
        lastEventId: this.parseLastEventId(
          lastEventIdHeader ?? lastEventIdQuery,
        ),
      })
      .pipe(map(event => this.toMessageEvent(event)));

    const heartbeat$ = interval(this.heartbeatMs()).pipe(
      map((): MessageEvent => ({
        type: INBOX_HEARTBEAT_EVENT,
        data: {
          emittedAt: new Date().toISOString(),
          lastEventId: this.events.lastEventId,
          reviewerId,
        },
      })),
    );

    return merge(updates$, heartbeat$);
  }

  private toMessageEvent(event: VerificationInboxEvent): MessageEvent {
    return {
      id: String(event.id),
      type: event.type,
      data: {
        eventId: event.id,
        emittedAt: event.emittedAt,
        ...event.payload,
      },
    };
  }

  private parseStatuses(raw?: string): string[] | undefined {
    if (!raw) {
      return undefined;
    }

    const statuses = raw
      .split(',')
      .map(value => value.trim())
      .filter(value => value.length > 0);

    return statuses.length > 0 ? statuses : undefined;
  }

  private parseLastEventId(raw?: string): number | null {
    if (!raw) {
      return null;
    }

    const parsed = Number.parseInt(raw, 10);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private heartbeatMs(): number {
    const raw = this.config.get<string>('VERIFICATION_INBOX_SSE_HEARTBEAT_MS');
    const parsed = Number.parseInt(String(raw ?? ''), 10);

    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_HEARTBEAT_MS;
  }
}
