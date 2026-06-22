export class IdempotencyError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
}

export class MissingKeyError extends IdempotencyError {
  constructor() {
    super('Missing required Idempotency-Key header for mutating requests', 400);
  }
}

export class InvalidKeyFormatError extends IdempotencyError {
  constructor(detail: string) {
    super(`Invalid Idempotency-Key format: ${detail}`, 400);
  }
}

export class FingerprintMismatchError extends IdempotencyError {
  constructor() {
    super(
      'Request body fingerprint does not match the original request for this idempotency key',
      409,
    );
  }
}

export class AlreadyProcessingError extends IdempotencyError {
  constructor() {
    super(
      'A request with this idempotency key is already being processed',
      409,
    );
  }
}
