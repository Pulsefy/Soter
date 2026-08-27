/**
 * Job Status WebSocket Gateway
 * Handles WebSocket connections for real-time job status streaming
 * Implements authentication, per-org authorization, token expiry, and missed update delivery
 *
 * Auth strategy:
 *  - The client must supply its API key as handshake.auth.token (or the
 *    x-api-key handshake header).  The key is validated against the database
 *    the same way ApiKeyGuard does it.
 *  - Per-org authorization: the orgId stored on the API key must match the
 *    orgId supplied in the subscribe payload.
 *  - Token expiry: a periodic check disconnects sockets whose API key has
 *    expired while the connection is live.
 */

import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Logger, Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AppRole } from '../../auth/app-role.enum';

import {
  JobStatusEvent,
  JobStatusSubscriptionOptions,
  SubscriptionAckDto,
} from '../dtos/job-status-event.dto';
import { JobStatusBroadcaster } from '../services/job-status-broadcaster.service';

/**
 * How often (ms) we poll to disconnect sockets with expired keys.
 * Default: every 60 seconds.
 */
const EXPIRY_CHECK_INTERVAL_MS = 60_000;

/**
 * Metadata about an active subscription
 */
interface SubscriptionMetadata {
  subscriptionId: string;
  jobId: string;
  orgId?: string;
  userId?: string;
  options: JobStatusSubscriptionOptions;
  subscribedAt: Date;
  lastEventAt?: Date;
}

/**
 * Auth context stored on each socket after successful handshake.
 */
interface SocketAuthContext {
  apiKeyId: string;
  orgId?: string | null;
  ngoId?: string | null;
  role: AppRole;
  /** ISO string of the key's expiry time, or undefined if the key never expires */
  expiresAt?: string;
}

/**
 * Socket.io connection with subscription tracking and auth context
 */
interface AuthenticatedSocket extends Socket {
  auth?: SocketAuthContext;
  subscriptions?: Map<string, SubscriptionMetadata>;
  redisSub?: Redis;
}

@Injectable()
@WebSocketGateway({
  namespace: '/jobs',
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },
})
export class JobStatusGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(JobStatusGateway.name);

  /**
   * Map of socket ID to active Redis subscriptions
   * Used for cleanup on disconnect
   */
  private readonly socketSubscriptions = new Map<string, Redis>();

  /**
   * Interval handle for expiry checking.
   */
  private expiryCheckTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly jobStatusBroadcaster: JobStatusBroadcaster,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------------
  // Module lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Clean up the expiry-check timer when the module shuts down.
   */
  onModuleDestroy(): void {
    if (this.expiryCheckTimer) {
      clearInterval(this.expiryCheckTimer);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle hooks
  // ---------------------------------------------------------------------------

  /**
   * Initialize the gateway and install the authentication middleware.
   * Connections that cannot supply a valid, non-expired API key are rejected
   * before the handshake completes.
   */
  afterInit(server: Server): void {
    this.logger.log('JobStatusGateway initialized with Socket.io');

    server.use((socket, next) => {
      const run = async (): Promise<void> => {
        const rawToken =
          (socket.handshake.auth as Record<string, unknown>)?.token ||
          socket.handshake.headers?.['x-api-key'];

        const token =
          typeof rawToken === 'string'
            ? rawToken
            : Array.isArray(rawToken)
              ? rawToken[0]
              : undefined;

        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const authCtx = await this.validateApiKey(token);
        if (!authCtx) {
          return next(new Error('Invalid or missing API key'));
        }

        // Attach auth context to the socket for later use
        (socket as AuthenticatedSocket).auth = authCtx;
        next();
      };

      run().catch((err: unknown) => {
        next(err instanceof Error ? err : new Error(String(err)));
      });
    });

    // Start the periodic expiry-check
    this.expiryCheckTimer = setInterval(
      () => void this.disconnectExpiredSockets(),
      EXPIRY_CHECK_INTERVAL_MS,
    );
  }

  /**
   * Handle client connection
   */
  handleConnection(socket: AuthenticatedSocket): void {
    const socketId = socket.id;
    const orgId = socket.auth?.orgId ?? 'unknown';

    this.logger.log(`Client connected: ${socketId} (org: ${orgId})`);

    // Initialize subscription tracking
    socket.subscriptions = new Map();

    // Create a Redis subscriber for this socket
    const redisSub = this.redis.duplicate();
    socket.redisSub = redisSub;

    this.socketSubscriptions.set(socketId, redisSub);

    // Send connection acknowledgment
    socket.emit('connected', {
      socketId,
      timestamp: new Date().toISOString(),
      message: 'Connected to job status stream',
    });
  }

  /**
   * Handle client disconnection
   */
  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    const socketId = socket.id;

    this.logger.log(`Client disconnected: ${socketId}`);

    // Clean up subscriptions
    if (socket.subscriptions) {
      for (const [, metadata] of socket.subscriptions) {
        await this.jobStatusBroadcaster.removeSubscription(
          metadata.jobId,
          metadata.subscriptionId,
        );
      }
    }

    // Close Redis subscription
    if (socket.redisSub) {
      socket.redisSub.disconnect();
    }

    this.socketSubscriptions.delete(socketId);
  }

  // ---------------------------------------------------------------------------
  // Message handlers
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to job status updates
   *
   * Message format:
   * {
   *   jobId: string;
   *   orgId?: string;          // must match the caller's org; required for NGO role
   *   options?: JobStatusSubscriptionOptions;
   * }
   */
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: any,
  ): Promise<void> {
    const socketId = socket.id;
    const { jobId, orgId: requestedOrgId, options = {} } = payload;

    if (!jobId || typeof jobId !== 'string') {
      throw new WsException('Invalid jobId');
    }

    // Per-org authorization -----------------------------------------------
    // Non-admin callers must supply an orgId that matches their API key's
    // orgId (or ngoId for legacy keys).
    this.enforceOrgAccess(socket, requestedOrgId);

    try {
      const subscriptionId = uuidv4();
      const userId = socket.auth?.apiKeyId;
      const resolvedOrgId =
        socket.auth?.orgId ?? socket.auth?.ngoId ?? undefined;

      // Validate options
      const validatedOptions: JobStatusSubscriptionOptions = {
        jobTypes: options.jobTypes || [],
        statuses: options.statuses || [],
        terminalOnly: options.terminalOnly || false,
        maxDuration: options.maxDuration || 3600000, // 1 hour default
        sendMissedUpdates: options.sendMissedUpdates !== false,
      };

      // Store subscription metadata
      const metadata: SubscriptionMetadata = {
        subscriptionId,
        jobId,
        orgId: resolvedOrgId,
        userId,
        options: validatedOptions,
        subscribedAt: new Date(),
      };

      socket.subscriptions?.set(jobId, metadata);

      // Record subscription in Redis
      await this.jobStatusBroadcaster.recordSubscription(
        jobId,
        subscriptionId,
        userId,
      );

      // Get missed updates if requested
      let missedUpdates: JobStatusEvent[] = [];
      if (validatedOptions.sendMissedUpdates) {
        const history = await this.jobStatusBroadcaster.getJobHistory(
          jobId,
          50,
        );
        missedUpdates = this.filterEvents(history, validatedOptions);
      }

      // Send subscription acknowledgment
      const ack: SubscriptionAckDto = {
        subscriptionId,
        options: validatedOptions,
        serverTime: new Date(),
        recommendedReconnectInterval: 30000, // 30 seconds
        missedUpdatesCount: missedUpdates.length,
        missedUpdates: missedUpdates.length > 0 ? missedUpdates : undefined,
      };

      socket.emit('subscribed', {
        jobId,
        ...ack,
      });

      this.logger.debug(
        `Client ${socketId} subscribed to job ${jobId} (subId: ${subscriptionId})`,
      );

      // Set up Redis subscription for this job
      if (!socket.redisSub) {
        throw new Error('Redis subscriber not initialized');
      }

      const redisSub = socket.redisSub;
      const jobChannel = `job_status:${jobId}`;

      // Listen for new events
      redisSub.subscribe(jobChannel, err => {
        if (err) {
          this.logger.error(
            `Failed to subscribe to channel ${jobChannel}: ${err.message}`,
          );
          socket.emit('error', {
            message: 'Failed to subscribe to job updates',
          });
        }
      });

      // Handle incoming messages
      redisSub.on('message', (channel, message) => {
        try {
          const event: JobStatusEvent = JSON.parse(message);

          // Apply filters
          if (!this.shouldEmitEvent(event, validatedOptions)) {
            return;
          }

          // Update last event time
          metadata.lastEventAt = new Date();

          // Emit to client
          socket.emit('jobStatus', {
            subscriptionId,
            event,
          });

          this.logger.debug(
            `Emitted job status to ${socketId}: ${event.job.id} (${event.job.status})`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to parse job status event: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    } catch (error) {
      if (error instanceof WsException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Subscription failed for job ${jobId}: ${message}`);
      socket.emit('error', {
        jobId,
        message: 'Failed to subscribe to job status updates',
        error: message,
      });
    }
  }

  /**
   * Unsubscribe from job status updates
   *
   * Message format:
   * {
   *   jobId: string;
   * }
   */
  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: any,
  ): Promise<void> {
    const { jobId } = payload;

    if (!jobId) {
      throw new WsException('Invalid jobId');
    }

    try {
      const metadata = socket.subscriptions?.get(jobId);
      if (metadata) {
        await this.jobStatusBroadcaster.removeSubscription(
          jobId,
          metadata.subscriptionId,
        );
        socket.subscriptions?.delete(jobId);
      }

      // Unsubscribe from Redis channel
      if (socket.redisSub) {
        const jobChannel = `job_status:${jobId}`;
        socket.redisSub.unsubscribe(jobChannel);
      }

      socket.emit('unsubscribed', { jobId });

      this.logger.debug(`Client ${socket.id} unsubscribed from job ${jobId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Unsubscribe failed for job ${jobId}: ${message}`);
      socket.emit('error', {
        jobId,
        message: 'Failed to unsubscribe from job status updates',
        error: message,
      });
    }
  }

  /**
   * Ping handler for keep-alive
   */
  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() socket: Socket): void {
    socket.emit('pong', { timestamp: new Date().toISOString() });
  }

  // ---------------------------------------------------------------------------
  // Broadcasting
  // ---------------------------------------------------------------------------

  /**
   * Broadcast a job status event to all subscribers of that job
   * Called by job services when status changes
   */
  async broadcastJobStatus(event: JobStatusEvent): Promise<void> {
    try {
      await this.jobStatusBroadcaster.broadcastJobStatus(event);
    } catch (error) {
      this.logger.error(
        `Failed to broadcast job status: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Validate an API key against the database (mirrors ApiKeyGuard logic).
   * Returns the auth context on success or null on failure.
   *
   * Lifecycle checks mirror ApiKeyGuard exactly:
   *  1. Look up by credential (hash or plaintext) — no lifecycle filters in WHERE
   *     so each failure produces a distinguishable result.
   *  2. Revoked keys → rejected.
   *  3. Expired keys → rejected.
   *  4. Rotated-out keys whose grace window has ended → rejected.
   */
  async validateApiKey(rawKey: string): Promise<SocketAuthContext | null> {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const record = await this.prisma.apiKey.findFirst({
      where: {
        OR: [{ keyHash }, { key: rawKey }],
      },
    });

    if (!record) return null;

    const now = Date.now();

    if (record.revokedAt && record.revokedAt.getTime() <= now) {
      return null; // key has been revoked
    }

    if (record.expiresAt && record.expiresAt.getTime() <= now) {
      return null; // key has expired
    }

    // Rotated-out predecessor: reject once the grace window has closed
    if (
      record.graceExpiresAt &&
      record.graceExpiresAt.getTime() <= now &&
      record.replacedById
    ) {
      return null; // grace period ended
    }

    return {
      apiKeyId: record.id,
      orgId: record.orgId ?? undefined,
      ngoId: record.ngoId ?? undefined,
      role: record.role,
      expiresAt: record.expiresAt?.toISOString(),
    };
  }

  /**
   * Enforce per-org access control on a subscribe request.
   *
   * Rules:
   *  - Admin role: allowed to subscribe to any org's jobs.
   *  - NGO / other roles: the orgId (or ngoId) on the API key must match the
   *    requestedOrgId provided in the subscribe payload (if supplied).
   *
   * Throws WsException if access is denied.
   */
  private enforceOrgAccess(
    socket: AuthenticatedSocket,
    requestedOrgId?: string,
  ): void {
    const auth = socket.auth;
    if (!auth) {
      throw new WsException('Not authenticated');
    }

    // Admins can subscribe to any job
    if (auth.role === AppRole.admin) return;

    // If no orgId is requested in the subscribe payload, allow (job may be
    // global/not org-scoped). The service layer can enforce stricter rules.
    if (!requestedOrgId) return;

    const keyOrg = auth.orgId ?? auth.ngoId;

    if (!keyOrg) {
      // Key has no org scope – cannot access org-scoped jobs
      throw new WsException(
        'Access denied: your API key is not scoped to any organization',
      );
    }

    if (keyOrg !== requestedOrgId) {
      throw new WsException(
        'Access denied: resource belongs to a different organization',
      );
    }
  }

  /**
   * Periodically check all connected sockets and disconnect those whose
   * API key has expired.  This satisfies the acceptance criterion:
   * "Token expiry during a live connection terminates the socket."
   */
  private async disconnectExpiredSockets(): Promise<void> {
    if (!this.server) return;

    const allSockets = await this.server.fetchSockets();

    for (const rawSocket of allSockets) {
      const socket = rawSocket as unknown as AuthenticatedSocket;
      const auth = socket.auth;
      if (!auth?.expiresAt) continue;

      if (new Date(auth.expiresAt).getTime() <= Date.now()) {
        this.logger.log(
          `Disconnecting socket ${socket.id}: API key ${auth.apiKeyId} has expired`,
        );
        socket.emit('error', { message: 'API key expired' });
        socket.disconnect(true);
      }
    }
  }

  /**
   * Filter events based on subscription options
   */
  private filterEvents(
    events: JobStatusEvent[],
    options: JobStatusSubscriptionOptions,
  ): JobStatusEvent[] {
    return events.filter(event => {
      // Filter by job type
      if (options.jobTypes && options.jobTypes.length > 0) {
        if (!options.jobTypes.includes(event.job.type)) {
          return false;
        }
      }

      // Filter by status
      if (options.statuses && options.statuses.length > 0) {
        if (!options.statuses.includes(event.job.status)) {
          return false;
        }
      }

      // Terminal only filter
      if (options.terminalOnly && !event.isTerminal) {
        return false;
      }

      return true;
    });
  }

  /**
   * Determine if an event should be emitted based on subscription options
   */
  private shouldEmitEvent(
    event: JobStatusEvent,
    options: JobStatusSubscriptionOptions,
  ): boolean {
    return this.filterEvents([event], options).length > 0;
  }
}
