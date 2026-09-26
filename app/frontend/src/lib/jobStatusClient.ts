/**
 * Job Status Client Library
 * Utility class for subscribing to job status updates
 * 
 * Usage:
 * const client = new JobStatusClient('http://localhost:3000', token);
 * await client.subscribe('job_123', (status) => console.log(status));
 */

import { io, Socket } from 'socket.io-client';
import { useState, useEffect, useRef } from 'react';

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  RETRYING = 'retrying',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface JobStatusInfo {
  id: string;
  type: string;
  status: JobStatus;
  progress?: number;
  result?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface JobStatusEvent {
  eventId: string;
  job: JobStatusInfo;
  userId?: string;
  correlationId?: string;
  emittedAt: Date;
  isTerminal: boolean;
  metadata?: any;
}

export interface SubscriptionOptions {
  jobTypes?: string[];
  statuses?: JobStatus[];
  terminalOnly?: boolean;
  maxDuration?: number;
  sendMissedUpdates?: boolean;
}

export interface StatusCallback {
  (status: JobStatusInfo, event: JobStatusEvent): void;
}

export interface ErrorCallback {
  (error: any): void;
}

/**
 * Client for subscribing to job status updates via WebSocket
 * with automatic reconnection and missed-update handling
 */
export class JobStatusClient {
  private socket: Socket | null = null;
  private subscriptions = new Map<string, {
    callback: StatusCallback;
    errorCallback?: ErrorCallback;
    options: SubscriptionOptions;
  }>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 30000; // 30 seconds
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(
    private baseUrl: string,
    private token: string,
    private options: {
      reconnect?: boolean;
      debug?: boolean;
    } = {}
  ) {
    this.options.reconnect = this.options.reconnect !== false;
    this.options.debug = this.options.debug || false;
  }

  /**
   * Connect to the job status stream server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.baseUrl, {
          path: '/socket.io/jobs',
          auth: { token: this.token },
          reconnection: this.options.reconnect,
          reconnectionDelay: this.calculateReconnectDelay(),
          reconnectionDelayMax: this.maxReconnectDelay,
        });

        this.socket.on('connect', () => {
          this.debug('Connected to job status stream');
          this.reconnectAttempts = 0;
          this.setupKeepAlive();
          resolve();
        });

        this.socket.on('connect_error', (error: any) => {
          this.debug('Connection error:', error);
          reject(error);
        });

        this.socket.on('disconnect', () => {
          this.debug('Disconnected from server');
          this.clearKeepAlive();
        });

        this.socket.on('connected', (data: any) => {
          this.debug('Server acknowledgment:', data);
        });

        this.socket.on('jobStatus', this.handleJobStatus.bind(this));
        this.socket.on('subscribed', this.handleSubscribed.bind(this));
        this.socket.on('unsubscribed', (data: any) => {
          this.debug(`Unsubscribed from job: ${data.jobId}`);
        });
        this.socket.on('error', this.handleError.bind(this));
        this.socket.on('pong', (data: any) => {
          this.debug('Pong received:', data.timestamp);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Subscribe to job status updates
   */
  subscribe(
    jobId: string,
    callback: StatusCallback,
    options: SubscriptionOptions = {},
    errorCallback?: ErrorCallback
  ): void {
    if (!this.socket) {
      throw new Error('Not connected. Call connect() first.');
    }

    const mergedOptions: SubscriptionOptions = {
      sendMissedUpdates: true,
      ...options,
    };

    this.subscriptions.set(jobId, {
      callback,
      errorCallback,
      options: mergedOptions,
    });

    this.socket.emit('subscribe', { jobId, options: mergedOptions });
  }

  /**
   * Unsubscribe from job status updates
   */
  unsubscribe(jobId: string): void {
    if (!this.socket) {
      return;
    }

    this.socket.emit('unsubscribe', { jobId });
    this.subscriptions.delete(jobId);
  }

  /**
   * Unsubscribe from all jobs
   */
  unsubscribeAll(): void {
    const jobIds = Array.from(this.subscriptions.keys());
    jobIds.forEach(jobId => this.unsubscribe(jobId));
  }

  /**
   * Get subscription status
   */
  isSubscribed(jobId: string): boolean {
    return this.subscriptions.has(jobId);
  }

  /**
   * Get all subscribed job IDs
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    if (this.socket) {
      this.clearKeepAlive();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Manually trigger reconnection
   */
  reconnect(): void {
    if (this.socket) {
      this.socket.connect();
    }
  }

  /**
   * Wait for a job to reach a terminal state
   */
  async waitForCompletion(
    jobId: string,
    options: SubscriptionOptions = {},
    timeout: number = 300000 // 5 minutes default
  ): Promise<JobStatusInfo> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.unsubscribe(jobId);
        reject(new Error(`Job ${jobId} did not complete within ${timeout}ms`));
      }, timeout);

      this.subscribe(
        jobId,
        (status, event) => {
          if (event.isTerminal) {
            clearTimeout(timeoutHandle);
            this.unsubscribe(jobId);
            resolve(status);
          }
        },
        options,
        (error) => {
          clearTimeout(timeoutHandle);
          this.unsubscribe(jobId);
          reject(error);
        }
      );
    });
  }

  /**
   * Get current job status via REST API (polling fallback)
   */
  async getStatus(jobId: string): Promise<JobStatusInfo> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/jobs/${jobId}/status`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to get job status: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get job status history via REST API
   */
  async getHistory(jobId: string, limit: number = 50): Promise<JobStatusEvent[]> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/jobs/${jobId}/history?limit=${limit}`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to get job history: ${response.statusText}`);
    }
    const data = await response.json();
    return data.events;
  }

  /**
   * Private: Handle incoming job status
   */
  private handleJobStatus(data: any): void {
    const { subscriptionId, event } = data;
    const jobId = event.job.id;
    const subscription = this.subscriptions.get(jobId);

    if (subscription) {
      try {
        subscription.callback(event.job, event);
      } catch (error) {
        this.debug('Error in callback:', error);
      }
    }
  }

  /**
   * Private: Handle subscription acknowledgment
   */
  private handleSubscribed(ack: any): void {
    this.debug(`Subscribed to job ${ack.jobId}:`, ack);

    // Deliver missed updates if any
    if (ack.missedUpdates && ack.missedUpdates.length > 0) {
      this.debug(`Delivering ${ack.missedUpdates.length} missed updates`);
      for (const event of ack.missedUpdates) {
        this.handleJobStatus({ subscriptionId: ack.subscriptionId, event });
      }
    }
  }

  /**
   * Private: Handle errors
   */
  private handleError(error: any): void {
    this.debug('Error from server:', error);

    // Notify error callbacks
    if (error.jobId) {
      const subscription = this.subscriptions.get(error.jobId);
      if (subscription?.errorCallback) {
        subscription.errorCallback(error);
      }
    }
  }

  /**
   * Private: Calculate reconnect delay with exponential backoff
   */
  private calculateReconnectDelay(): number {
    const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    return Math.min(delay, this.maxReconnectDelay);
  }

  /**
   * Private: Setup keep-alive ping
   */
  private setupKeepAlive(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping');
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Private: Clear keep-alive ping
   */
  private clearKeepAlive(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Private: Debug logging
   */
  private debug(...args: any[]): void {
    if (this.options.debug) {
      console.log('[JobStatusClient]', ...args);
    }
  }
}

/**
 * React hook for job status monitoring
 * Requires React to be available
 */
export function useJobStatus(
  baseUrl: string,
  token: string,
  jobId: string | null,
  options: SubscriptionOptions = {}
) {
  const [status, setStatus] = useState<JobStatusInfo | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const clientRef = useRef<JobStatusClient | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const initializeClient = async () => {
      try {
        if (!clientRef.current) {
          clientRef.current = new JobStatusClient(baseUrl, token, {
            debug: false,
          });
          await clientRef.current.connect();
        }

        setLoading(true);
        clientRef.current.subscribe(
          jobId,
          (newStatus) => {
            setStatus(newStatus);
            setError(null);
            setLoading(false);
          },
          options,
          (err) => {
            setError(err);
            setLoading(false);
          }
        );

        return () => {
          if (clientRef.current) {
            clientRef.current.unsubscribe(jobId);
          }
        };
      } catch (err) {
        setError(err);
        setLoading(false);
      }
    };

    const cleanup = initializeClient();
    return () => {
      cleanup?.then((fn: any) => fn?.());
    };
  }, [jobId, baseUrl, token]);

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, []);

  return { status, error, loading };
}
