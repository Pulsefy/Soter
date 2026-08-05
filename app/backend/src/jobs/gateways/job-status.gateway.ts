/**
 * Job Status WebSocket Gateway
 * Handles WebSocket connections for real-time job status streaming
 * Implements reconnect handling and missed update delivery
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
import { Logger, Injectable, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

import {
  JobStatusEvent,
  JobStatusSubscriptionOptions,
  SubscriptionAckDto,
} from '../dtos/job-status-event.dto';
import { JobStatusBroadcaster } from '../services/job-status-broadcaster.service';

/**
 * Metadata about an active subscription
 */
interface SubscriptionMetadata {
  subscriptionId: string;
  jobId: string;
  userId?: string;
  options: JobStatusSubscriptionOptions;
  subscribedAt: Date;
  lastEventAt?: Date;
}

/**
 * Socket.io connection with subscription tracking
 */
interface AuthenticatedSocket extends Socket {
  user?: { id: string; email: string };
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
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(JobStatusGateway.name);

  /**
   * Map of socket ID to active Redis subscriptions
   * Used for cleanup on disconnect
   */
  private readonly socketSubscriptions = new Map<string, Redis>();

  constructor(
    private readonly jobStatusBroadcaster: JobStatusBroadcaster,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Initialize the gateway
   */
  afterInit(server: Server): void {
    this.logger.log('JobStatusGateway initialized with Socket.io');

    // Set up global middleware for authentication
    server.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // TODO: Validate JWT token - implement based on your auth strategy
        // For now, we'll allow all connections
        next();
      } catch (error) {
        next(error);
      }
    });
  }

  /**
   * Handle client connection
   */
  handleConnection(socket: AuthenticatedSocket): void {
    const socketId = socket.id;
    const userId =
      socket.user?.id || (socket.handshake.headers['x-user-id'] as string);

    this.logger.log(
      `Client connected: ${socketId} (user: ${userId || 'anonymous'})`,
    );

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

  /**
   * Subscribe to job status updates
   *
   * Message format:
   * {
   *   jobId: string;
   *   options?: JobStatusSubscriptionOptions;
   * }
   */
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: any,
  ): Promise<void> {
    const socketId = socket.id;
    const { jobId, options = {} } = payload;

    if (!jobId || typeof jobId !== 'string') {
      throw new WsException('Invalid jobId');
    }

    try {
      const subscriptionId = uuidv4();
      const userId = socket.user?.id;

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
}
