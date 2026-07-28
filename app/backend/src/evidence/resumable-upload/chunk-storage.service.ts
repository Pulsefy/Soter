import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync, createReadStream } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class ChunkStorageService implements OnModuleInit {
  private readonly logger = new Logger(ChunkStorageService.name);
  private readonly chunkRoot: string;

  constructor() {
    this.chunkRoot = path.join(process.cwd(), 'uploads', 'chunks');
  }

  onModuleInit(): void {
    if (!existsSync(this.chunkRoot)) {
      mkdirSync(this.chunkRoot, { recursive: true });
      this.logger.log(`Created chunk storage root at ${this.chunkRoot}`);
    }
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.chunkRoot, sessionId.slice(0, 2), sessionId);
  }

  private chunkPath(sessionId: string, index: number): string {
    return path.join(this.sessionDir(sessionId), `chunk-${index}.bin`);
  }

  async storeChunk(
    sessionId: string,
    index: number,
    data: Buffer,
  ): Promise<string> {
    const dir = this.sessionDir(sessionId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const filePath = this.chunkPath(sessionId, index);
    await fs.writeFile(filePath, data);
    return filePath;
  }

  async readChunk(sessionId: string, index: number): Promise<Buffer | null> {
    const filePath = this.chunkPath(sessionId, index);
    try {
      return await fs.readFile(filePath);
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: unknown }).code === 'ENOENT'
      )
        return null;
      throw err;
    }
  }

  async verifyChunkOnDisk(
    sessionId: string,
    index: number,
    expectedChecksum: string,
    expectedSize: number,
  ): Promise<{
    ok: boolean;
    actualSize: number;
    actualChecksum: string | null;
    filePath: string;
  }> {
    const filePath = this.chunkPath(sessionId, index);
    try {
      const stat = await fs.stat(filePath);
      if (stat.size !== expectedSize) {
        return {
          ok: false,
          actualSize: stat.size,
          actualChecksum: null,
          filePath,
        };
      }
      const data = await fs.readFile(filePath);
      const actualChecksum = crypto
        .createHash('sha256')
        .update(data)
        .digest('hex');
      return {
        ok: actualChecksum === expectedChecksum,
        actualSize: data.length,
        actualChecksum,
        filePath,
      };
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: unknown }).code === 'ENOENT'
      ) {
        return {
          ok: false,
          actualSize: 0,
          actualChecksum: null,
          filePath,
        };
      }
      throw err;
    }
  }

  async chunkExists(sessionId: string, index: number): Promise<boolean> {
    const filePath = this.chunkPath(sessionId, index);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteChunk(sessionId: string, index: number): Promise<boolean> {
    const filePath = this.chunkPath(sessionId, index);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: unknown }).code === 'ENOENT'
      )
        return false;
      throw err;
    }
  }

  async assembleAllChunks(
    sessionId: string,
    totalChunks: number,
  ): Promise<{ buffer: Buffer; checksums: string[]; sizes: number[] }> {
    const buffers: Buffer[] = [];
    const checksums: string[] = [];
    const sizes: number[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const data = await this.readChunk(sessionId, i);
      if (!data) {
        throw new Error(
          `Chunk ${i} for session ${sessionId} is missing from disk storage`,
        );
      }
      buffers.push(data);
      sizes.push(data.length);
      checksums.push(crypto.createHash('sha256').update(data).digest('hex'));
    }

    return {
      buffer: Buffer.concat(buffers),
      checksums,
      sizes,
    };
  }

  async getChunkStream(
    sessionId: string,
    index: number,
  ): Promise<ReturnType<typeof createReadStream>> {
    const filePath = this.chunkPath(sessionId, index);
    return createReadStream(filePath);
  }

  async cleanupSession(sessionId: string): Promise<void> {
    const dir = this.sessionDir(sessionId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: unknown }).code === 'ENOENT'
      ) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to remove chunk directory ${dir}: ${message}`);
    }
  }

  async cleanupExpired(
    sessionIdsToKeep: Set<string>,
  ): Promise<{ removedSessions: number; removedBytes: number }> {
    let removedSessions = 0;
    let removedBytes = 0;
    const prefixDirs = await fs.readdir(this.chunkRoot);
    for (const prefix of prefixDirs) {
      const prefixPath = path.join(this.chunkRoot, prefix);
      let stat;
      try {
        stat = await fs.stat(prefixPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      const sessionDirs = await fs.readdir(prefixPath);
      for (const sessId of sessionDirs) {
        if (sessionIdsToKeep.has(sessId)) continue;
        const sessionPath = path.join(prefixPath, sessId);
        try {
          const files = await fs.readdir(sessionPath);
          for (const file of files) {
            try {
              const fstat = await fs.stat(path.join(sessionPath, file));
              removedBytes += fstat.size;
            } catch {
              // ignore
            }
          }
          await fs.rm(sessionPath, { recursive: true, force: true });
          removedSessions++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Failed to clean up expired chunk session ${sessId}: ${message}`,
          );
        }
      }
      try {
        const remaining = await fs.readdir(prefixPath);
        if (remaining.length === 0) {
          await fs.rmdir(prefixPath);
        }
      } catch {
        // ignore
      }
    }
    return { removedSessions, removedBytes };
  }
}
