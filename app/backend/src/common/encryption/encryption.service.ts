import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM_GCM = 'aes-256-gcm';
const ALGORITHM_CBC = 'aes-256-cbc';
const IV_GCM_BYTES = 12;
const IV_CBC_BYTES = 16;

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;
  private readonly deterministicIv: Buffer;

  constructor(private readonly configService: ConfigService) {
    const masterKey = this.configService.get<string>('ENCRYPTION_MASTER_KEY');
    if (!masterKey) {
      this.logger.warn(
        'ENCRYPTION_MASTER_KEY is not set. Using insecure fallback. Set this before production deployment.',
      );
    }
    const keyMaterial =
      masterKey ?? 'insecure-default-change-in-production!!!!!';
    this.key = crypto.createHash('sha256').update(keyMaterial).digest();
    this.deterministicIv = crypto
      .createHmac('sha256', this.key)
      .update('deterministic-iv-v1')
      .digest()
      .subarray(0, IV_CBC_BYTES);
  }

  /**
   * Encrypts plaintext using AES-256-GCM with a random IV.
   * Non-deterministic: ciphertext differs on every call.
   * Format: <ivHex>:<authTagHex>:<ciphertextHex>
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_GCM_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM_GCM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypts a value produced by encrypt().
   */
  decrypt(encryptedValue: string): string {
    const parts = encryptedValue.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted value: unexpected format');
    }
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM_GCM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Encrypts plaintext using AES-256-CBC with a fixed deterministic IV.
   * Same plaintext + same key always produces the same ciphertext.
   * Use for fields that must remain queryable via equality lookups.
   * Format: <ciphertextHex>
   */
  encryptDeterministic(plaintext: string): string {
    const cipher = crypto.createCipheriv(
      ALGORITHM_CBC,
      this.key,
      this.deterministicIv,
    );
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return encrypted.toString('hex');
  }

  /**
   * Decrypts a value produced by encryptDeterministic().
   */
  decryptDeterministic(encryptedValue: string): string {
    const ciphertext = Buffer.from(encryptedValue, 'hex');
    const decipher = crypto.createDecipheriv(
      ALGORITHM_CBC,
      this.key,
      this.deterministicIv,
    );
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
