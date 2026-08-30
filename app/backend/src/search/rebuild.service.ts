import { db } from '../db'; // Replace with your actual DB instance (Prisma, TypeORM, etc.)
import { searchClient } from './client'; // Replace with your Search Client (Elastic, Algolia, etc.)
import { logger } from '../utils/logger';

const BATCH_SIZE = 500;

interface RebuildState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  lastProcessedId: string | null;
  totalProcessed: number;
  updatedAt: Date;
}

export class SearchRebuildService {
  // Simulating state storage (ideally store this in Redis or a DB table for cross-node safety)
  private state: RebuildState = {
    status: 'idle',
    lastProcessedId: null,
    totalProcessed: 0,
    updatedAt: new Date(),
  };

  async getStatus(): Promise<RebuildState> {
    // In production, fetch from Redis/DB
    return this.state;
  }

  async startRebuild(options: { dryRun?: boolean; resume?: boolean } = {}) {
    if (options.dryRun) {
      const totalCount = await db.entities.count();
      return { status: 'dry_run', estimatedDocuments: totalCount };
    }

    if (this.state.status === 'running') {
      throw new Error('A rebuild is already in progress. Concurrent rebuilds are rejected.');
    }

    // Initialize state
    this.state = {
      status: 'running',
      lastProcessedId: options.resume ? this.state.lastProcessedId : null,
      totalProcessed: options.resume ? this.state.totalProcessed : 0,
      updatedAt: new Date(),
    };

    // Kick off background processing without blocking the HTTP response
    this.processInBatches().catch((err) => {
      logger.error('Search rebuild failed', err);
      this.state.status = 'failed';
      this.state.updatedAt = new Date();
    });

    return { message: 'Rebuild started successfully', state: this.state };
  }

  private async processInBatches() {
    let hasMore = true;

    while (hasMore && this.state.status === 'running') {
      // 1. Fetch batch using keyset pagination (cursor)
      const batch = await db.entities.findMany({
        where: this.state.lastProcessedId ? { id: { gt: this.state.lastProcessedId } } : {},
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });

      if (batch.length === 0) {
        hasMore = false;
        this.state.status = 'completed';
        this.state.updatedAt = new Date();
        logger.info(`Search rebuild completed. Total processed: ${this.state.totalProcessed}`);
        break;
      }

      // 2. Format and index batch
      const documents = batch.map((entity) => ({
        id: entity.id,
        title: entity.title,
        content: entity.content,
        // ... mapping logic
      }));

      await searchClient.indexDocuments(documents);

      // 3. Update state for visibility and resumability
      this.state.lastProcessedId = batch[batch.length - 1].id;
      this.state.totalProcessed += batch.length;
      this.state.updatedAt = new Date();

      // Yield to event loop to avoid blocking live app processes
      await new Promise((resolve) => setTimeout(resolve, 50)); 
    }
  }

  async stopRebuild() {
    if (this.state.status === 'running') {
      this.state.status = 'idle';
      this.state.updatedAt = new Date();
    }
    return this.state;
  }
}
