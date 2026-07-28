import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

interface FingerprintOptions {
  algorithm?: 'sha256' | 'sha512' | 'md5';
  normalizeText?: boolean;
  includeMetadata?: boolean;
}

interface SimilarityResult {
  isDuplicate: boolean;
  similarity: number;
  threshold: number;
}

@Injectable()
export class FingerprintService {
  private readonly logger = new Logger(FingerprintService.name);
  private readonly SIMILARITY_THRESHOLD = 0.85;

  /**
   * Generate a stable fingerprint for a file buffer
   */
  generateFileFingerprint(
    buffer: Buffer,
    options: FingerprintOptions = {},
  ): string {
    const { algorithm = 'sha256' } = options;

    return crypto.createHash(algorithm).update(buffer).digest('hex');
  }

  /**
   * Generate a stable fingerprint for text content
   * Normalizes text to detect near-duplicates
   */
  generateTextFingerprint(
    text: string,
    options: FingerprintOptions = {},
  ): string {
    const { algorithm = 'sha256', normalizeText = true } = options;

    let processedText = text;

    if (normalizeText) {
      // Normalize text for near-duplicate detection
      processedText = this.normalizeText(text);
    }

    return crypto.createHash(algorithm).update(processedText).digest('hex');
  }

  /**
   * Normalize text for fingerprinting
   * Removes extra whitespace, normalizes case, removes special chars
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  /**
   * Calculate similarity between two text strings using Levenshtein distance
   * Returns a value between 0 (no similarity) and 1 (identical)
   */
  calculateTextSimilarity(text1: string, text2: string): number {
    const normalized1 = this.normalizeText(text1);
    const normalized2 = this.normalizeText(text2);

    if (normalized1 === normalized2) return 1;
    if (normalized1.length === 0 || normalized2.length === 0) return 0;

    const distance = this.levenshteinDistance(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);

    return 1 - distance / maxLength;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Check if two fingerprints are similar enough to be considered near-duplicates
   */
  isNearDuplicate(
    fingerprint1: string,
    fingerprint2: string,
    threshold?: number,
  ): SimilarityResult {
    const similarityThreshold = threshold ?? this.SIMILARITY_THRESHOLD;

    // For exact hash comparison, we can't calculate similarity
    // Instead, we check if they're identical (exact duplicate)
    const isExactMatch = fingerprint1 === fingerprint2;

    if (isExactMatch) {
      return {
        isDuplicate: true,
        similarity: 1,
        threshold: similarityThreshold,
      };
    }

    return {
      isDuplicate: false,
      similarity: 0,
      threshold: similarityThreshold,
    };
  }

  /**
   * Check if text content is a near-duplicate based on similarity threshold
   */
  isTextNearDuplicate(
    text1: string,
    text2: string,
    threshold?: number,
  ): SimilarityResult {
    const similarityThreshold = threshold ?? this.SIMILARITY_THRESHOLD;
    const similarity = this.calculateTextSimilarity(text1, text2);

    return {
      isDuplicate: similarity >= similarityThreshold,
      similarity,
      threshold: similarityThreshold,
    };
  }

  /**
   * Generate a combined fingerprint for multiple fields
   * Useful for composite deduplication
   */
  generateCompositeFingerprint(fields: Record<string, any>): string {
    const sortedKeys = Object.keys(fields).sort();
    const combined = sortedKeys
      .map(key => `${key}:${JSON.stringify(fields[key])}`)
      .join('|');

    return crypto.createHash('sha256').update(combined).digest('hex');
  }
}
