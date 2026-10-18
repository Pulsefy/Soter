import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export type BackpressureLevel = 'normal' | 'elevated' | 'critical';

export interface QueueBackpressureStatus {
  name: string;
  level: BackpressureLevel;
}

export interface BackpressureState {
  /** `true` when any monitored queue is under load (level is not `normal`). */
  active: boolean;
  /** Worst level across all monitored queues. */
  level: BackpressureLevel;
  /** Per-queue level. Queue depths are deliberately not exposed. */
  queues: QueueBackpressureStatus[];
  checkedAt: string;
}

export const DEFAULT_BACKPRESSURE_WAITING_THRESHOLD = 100;
export const DEFAULT_BACKPRESSURE_CRITICAL_MULTIPLIER = 5;
const CACHE_TTL_MS = 5_000;

const LEVEL_RANK: Record<BackpressureLevel, number> = {
  normal: 0,
  elevated: 1,
  critical: 2,
};

/**
 * Summarises how loaded the user-facing job queues (verification,
 * notifications, onchain) are so the frontend can warn that actions may be
 * slower than usual. A queue is `elevated` once its waiting backlog reaches
 * `BACKPRESSURE_WAITING_THRESHOLD` and `critical` at
 * `BACKPRESSURE_CRITICAL_MULTIPLIER` times that. The result is cached briefly
 * so frequent frontend polling cannot itself load Redis.
 */
@Injectable()
export class QueueBackpressureService {
  private readonly threshold: number;
  private readonly criticalThreshold: number;
  private readonly queues: Queue[];
  private cached: { at: number; state: BackpressureState } | null = null;

  constructor(
    config: ConfigService,
    @InjectQueue('verification') verificationQueue: Queue,
    @InjectQueue('notifications') notificationsQueue: Queue,
    @InjectQueue('onchain') onchainQueue: Queue,
  ) {
    this.queues = [verificationQueue, notificationsQueue, onchainQueue];
    this.threshold = positiveInt(
      config.get<string>('BACKPRESSURE_WAITING_THRESHOLD'),
      DEFAULT_BACKPRESSURE_WAITING_THRESHOLD,
    );
    this.criticalThreshold =
      this.threshold *
      positiveInt(
        config.get<string>('BACKPRESSURE_CRITICAL_MULTIPLIER'),
        DEFAULT_BACKPRESSURE_CRITICAL_MULTIPLIER,
      );
  }

  async getState(now: number = Date.now()): Promise<BackpressureState> {
    if (this.cached && now - this.cached.at < CACHE_TTL_MS) {
      return this.cached.state;
    }

    const queues = await Promise.all(
      this.queues.map(async queue => {
        try {
          return {
            name: queue.name,
            level: this.levelFor(await queue.getWaitingCount()),
          };
        } catch {
          // An unreachable queue must not break the signal (or the page).
          return { name: queue.name, level: 'normal' as BackpressureLevel };
        }
      }),
    );

    const level = queues.reduce<BackpressureLevel>(
      (worst, q) => (LEVEL_RANK[q.level] > LEVEL_RANK[worst] ? q.level : worst),
      'normal',
    );
    const state: BackpressureState = {
      active: level !== 'normal',
      level,
      queues,
      checkedAt: new Date(now).toISOString(),
    };
    this.cached = { at: now, state };
    return state;
  }

  private levelFor(waiting: number): BackpressureLevel {
    if (waiting >= this.criticalThreshold) return 'critical';
    if (waiting >= this.threshold) return 'elevated';
    return 'normal';
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return raw != null && Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
}
