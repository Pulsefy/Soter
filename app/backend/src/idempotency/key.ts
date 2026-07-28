import { Request } from 'express';
import { InvalidKeyFormatError, MissingKeyError } from './error';

const MAX_KEY_LEN = 128;
const KEY_REGEX = /^[a-zA-Z0-9\-_.]+$/;

export class IdempotencyKey {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static fromHeaders(req: Request): IdempotencyKey {
    const rawKey = req.headers['idempotency-key'] as string | undefined;

    if (!rawKey) {
      throw new MissingKeyError();
    }

    const trimmed = rawKey.trim();
    if (trimmed.length === 0) {
      throw new InvalidKeyFormatError('key must not be empty');
    }
    if (trimmed.length > MAX_KEY_LEN) {
      throw new InvalidKeyFormatError(
        `key exceeds maximum length of ${MAX_KEY_LEN}`,
      );
    }
    if (!KEY_REGEX.test(trimmed)) {
      throw new InvalidKeyFormatError(
        'key may only contain ASCII alphanumeric characters, hyphens, underscores, and dots',
      );
    }

    return new IdempotencyKey(trimmed);
  }

  public asString(): string {
    return this.value;
  }
}
