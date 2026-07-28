import crypto from 'crypto';

export class RequestFingerprint {
  private readonly hash: string;

  private constructor(hash: string) {
    this.hash = hash;
  }

  public static fromBody(body: Record<string, unknown>): RequestFingerprint {
    const sortedBody = RequestFingerprint.sortObjectKeys(body);
    const bodyString = JSON.stringify(sortedBody);
    const hash = crypto.createHash('sha256').update(bodyString).digest('hex');
    return new RequestFingerprint(hash);
  }

  public asString(): string {
    return this.hash;
  }

  private static sortObjectKeys(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      // Use arrow function to avoid unbound method lint error
      return obj.map(item => RequestFingerprint.sortObjectKeys(item));
    }
    if (obj !== null && typeof obj === 'object') {
      const record = obj as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce((result: Record<string, unknown>, key: string) => {
          result[key] = RequestFingerprint.sortObjectKeys(record[key]);
          return result;
        }, {});
    }
    return obj;
  }
}
