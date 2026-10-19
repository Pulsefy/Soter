import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { OrphanedArtifactsService } from './orphaned-artifacts.service';

@Injectable()
export class OrphanedArtifactsScheduler {
  private readonly logger = new Logger(OrphanedArtifactsScheduler.name);
  private isRunning = false;

  constructor(
    private readonly orphanedArtifactsService: OrphanedArtifactsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Runs daily at 02:00 UTC to identify orphaned evidence artifacts past the grace period.
   * By default, honors ORPHAN_ARTIFACTS_DRY_RUN (safe rollout mode).
   */
  @Cron('0 2 * * *', {
    name: 'orphaned-artifacts-detector',
    timeZone: 'UTC',
  })
  async scheduleOrphanedArtifactsDetection(): Promise<void> {
    const isEnabled =
      this.configService.get<string>('ORPHAN_ARTIFACTS_ENABLED') !== 'false';
    if (!isEnabled) {
      this.logger.debug(
        'Orphaned artifacts scheduled detection is disabled via config',
      );
      return;
    }

    if (this.isRunning) {
      this.logger.debug(
        'Orphaned artifacts detection job is already running, skipping this tick',
      );
      return;
    }

    this.isRunning = true;
    try {
      const dryRun =
        this.configService.get<string>('ORPHAN_ARTIFACTS_DRY_RUN') === 'true';
      const configuredGrace = this.configService.get<string>(
        'ORPHAN_ARTIFACT_GRACE_PERIOD_HOURS',
      );
      const gracePeriodHours = configuredGrace
        ? Number(configuredGrace)
        : undefined;

      this.logger.log(
        `Starting scheduled orphaned artifact detection (dryRun=${dryRun}, gracePeriodHours=${gracePeriodHours ?? 24})`,
      );

      const result =
        await this.orphanedArtifactsService.processOrphanedArtifacts({
          dryRun,
          gracePeriodHours,
        });

      this.logger.log(
        `Scheduled orphaned artifact scan complete: ${result.orphansFound} orphans found, ${result.newlyFlagged} newly flagged, ${result.totalSizeBytes} bytes total (dryRun=${result.dryRun})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Scheduled orphaned artifact detection failed: ${message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
