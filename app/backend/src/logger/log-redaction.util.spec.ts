import { redactLogData, assertNoPIIInLogs } from './log-redaction.util';

describe('Structured Logging - Redaction Utility (Issue #461)', () => {
  describe('redactLogData', () => {
    describe('Sensitive Key Redaction', () => {
      it('should redact password fields', () => {
        const data = { password: 'super-secret-123', username: 'john' };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.password).toBe('[REDACTED]');
        expect(result.username).toBe('john');
      });

      it('should redact API keys', () => {
        const data = { apikey: 'sk_live_abcd1234', apiKey: 'sk_live_5678' };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.apikey).toBe('[REDACTED]');
        expect(result.apiKey).toBe('[REDACTED]');
      });

      it('should redact authentication tokens', () => {
        const data = {
          token: 'token-123',
          access_token: 'access-456',
          bearer_token: 'bearer-789',
        };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.token).toBe('[REDACTED]');
        expect(result.access_token).toBe('[REDACTED]');
        expect(result.bearer_token).toBe('[REDACTED]');
      });

      it('should redact private keys', () => {
        const data = {
          privatekey: '-----BEGIN PRIVATE KEY-----',
          private_key: 'secret-key',
        };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.privatekey).toBe('[REDACTED]');
        expect(result.private_key).toBe('[REDACTED]');
      });

      it('should redact credit card numbers', () => {
        const data = { creditcard: '4532-1234-5678-9010' };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.creditcard).toBe('[REDACTED]');
      });

      it('should redact SSN in key names', () => {
        const data = { ssn: '123-45-6789' };
        const result = redactLogData(data) as Record<string, unknown>;
        // SSN patterns are redacted via pattern matching, not key-based redaction
        expect(result.ssn).toContain('[SSN]');
      });

      it('should handle case-insensitive key matching', () => {
        const data = {
          PASSWORD: 'secret1',
          PaSsWoRd: 'secret2',
          APIKEY: 'key1',
        };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.PASSWORD).toBe('[REDACTED]');
        expect(result.PaSsWoRd).toBe('[REDACTED]');
        expect(result.APIKEY).toBe('[REDACTED]');
      });
    });

    describe('PII Pattern Detection in Values', () => {
      it('should redact email addresses in string values', () => {
        const data = { userMessage: 'Contact me at john.doe@example.com' };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.userMessage).toContain('[EMAIL]');
        expect(result.userMessage).not.toContain('@');
      });

      it('should redact phone numbers in values', () => {
        const data = { contact: 'Call me at (555) 123-4567' };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.contact).toContain('[PHONE]');
        expect(result.contact).not.toContain('555');
      });

      it('should redact SSN patterns in values', () => {
        const data = { info: 'SSN: 123-45-6789' };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.info).toContain('[SSN]');
        expect(result.info).not.toContain('123-45-6789');
      });

      it('should redact credit card patterns in values', () => {
        const data = { payment: 'Card: 4532-1234-5678-9010' };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.payment).toContain('[CREDIT_CARD]');
        expect(result.payment).not.toContain('4532');
      });

      it('should handle multiple PII patterns in one value', () => {
        const data = {
          userData: 'Email: test@example.com, Phone: 555-123-4567, SSN: 123-45-6789',
        };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.userData).toContain('[EMAIL]');
        expect(result.userData).toContain('[PHONE]');
        expect(result.userData).toContain('[SSN]');
      });
    });

    describe('Nested Object & Array Handling', () => {
      it('should redact nested objects', () => {
        const data = {
          user: {
            name: 'John Doe',
            password: 'secret123',
          },
        };
        const result = redactLogData(data) as Record<string, unknown>;
        const user = result.user as Record<string, unknown>;
        expect(user.name).toBe('John Doe');
        expect(user.password).toBe('[REDACTED]');
      });

      it('should redact arrays of objects', () => {
        const data = {
          users: [
            { name: 'John', apikey: 'key1' },
            { name: 'Jane', apikey: 'key2' },
          ],
        };
        const result = redactLogData(data) as Record<string, unknown>;
        const users = result.users as Array<Record<string, unknown>>;
        expect(users[0].name).toBe('John');
        expect(users[0].apikey).toBe('[REDACTED]');
        expect(users[1].apikey).toBe('[REDACTED]');
      });

      it('should redact deeply nested structures', () => {
        const data = {
          level1: {
            level2: {
              level3: {
                password: 'secret',
                name: 'value',
              },
            },
          },
        };
        const result = redactLogData(data) as Record<string, unknown>;
        const level1 = result.level1 as Record<string, unknown>;
        const level2 = level1.level2 as Record<string, unknown>;
        const level3 = level2.level3 as Record<string, unknown>;
        expect(level3.password).toBe('[REDACTED]');
        expect(level3.name).toBe('value');
      });

      it('should handle mixed arrays', () => {
        const data = {
          items: [
            'some string',
            { token: 'secret-token' },
            ['nested', { apikey: 'key' }],
          ],
        };
        const result = redactLogData(data) as Record<string, unknown>;
        const items = result.items as unknown[];
        expect(items[0]).toBe('some string');
        const obj = items[1] as Record<string, unknown>;
        expect(obj.token).toBe('[REDACTED]');
      });
    });

    describe('Edge Cases', () => {
      it('should handle null and undefined values', () => {
        const data = { a: null, b: undefined, c: 'value' };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.a).toBeNull();
        expect(result.b).toBeUndefined();
        expect(result.c).toBe('value');
      });

      it('should handle empty strings', () => {
        const data = { empty: '', name: 'value' };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.empty).toBe('');
        expect(result.name).toBe('value');
      });

      it('should handle numeric and boolean values', () => {
        const data = {
          count: 42,
          active: true,
          percentage: 99.9,
          disabled: false,
        };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.count).toBe(42);
        expect(result.active).toBe(true);
        expect(result.percentage).toBe(99.9);
        expect(result.disabled).toBe(false);
      });

      it('should handle circular references (max depth)', () => {
        const obj: any = { name: 'test' };
        obj.self = obj; // Create circular reference
        const result = redactLogData(obj, 5);
        expect(result).toBeDefined();
      });

      it('should preserve non-sensitive data', () => {
        const data = {
          requestId: '123-456',
          userId: 'user-789',
          route: '/api/users',
          statusCode: 200,
        };
        const result = redactLogData(data) as Record<string, unknown>;
        expect(result.requestId).toBe('123-456');
        expect(result.userId).toBe('user-789');
        expect(result.route).toBe('/api/users');
        expect(result.statusCode).toBe(200);
      });
    });

    describe('Request/Response Payload Scenarios', () => {
      it('should redact a complete request payload', () => {
        const request = {
          method: 'POST',
          url: '/api/users',
          body: {
            email: 'user@example.com',
            password: 'password123',
            phone: '555-123-4567',
          },
          headers: {
            authorization: 'Bearer token123',
            'content-type': 'application/json',
          },
        };
        const result = redactLogData(request) as Record<string, unknown>;
        const body = result.body as Record<string, unknown>;
        const headers = result.headers as Record<string, unknown>;

        expect(body.email).toContain('[EMAIL]');
        expect(body.password).toBe('[REDACTED]');
        expect(body.phone).toContain('[PHONE]');
        expect(headers.authorization).toBe('[REDACTED]');
        expect(headers['content-type']).toBe('application/json');
      });

      it('should redact a complete response payload', () => {
        const response = {
          statusCode: 200,
          data: {
            id: 'user-123',
            email: 'user@example.com',
            apiToken: 'secret-token',
          },
          metadata: {
            requestId: 'req-456',
            timestamp: '2024-01-01T00:00:00Z',
          },
        };
        const result = redactLogData(response) as Record<string, unknown>;
        const data = result.data as Record<string, unknown>;

        expect(result.statusCode).toBe(200);
        expect(data.id).toBe('user-123');
        expect(data.email).toContain('[EMAIL]');
        expect(data.apiToken).toBe('[REDACTED]');
      });
    });
  });

  describe('assertNoPIIInLogs', () => {
    it('should pass when no PII is present', () => {
      const data = {
        requestId: '123',
        route: '/api/test',
        statusCode: 200,
      };
      expect(() => assertNoPIIInLogs(data)).not.toThrow();
    });

    it('should throw when unredacted email is in logs', () => {
      const data = { message: 'test@example.com' };
      expect(() => assertNoPIIInLogs(data)).toThrow();
    });

    it('should throw when unredacted phone is in logs', () => {
      const data = { message: '(555) 123-4567' };
      expect(() => assertNoPIIInLogs(data)).toThrow();
    });

    it('should pass when PII is properly redacted', () => {
      const data = {
        message: 'Email: test@example.com',
        password: 'secret',
      };
      const redacted = redactLogData(data);
      expect(() => assertNoPIIInLogs(redacted)).not.toThrow();
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle OAuth callback with credentials', () => {
      const payload = {
        code: 'auth-code-123',
        state: 'state-456',
        redirect_uri: 'https://app.example.com/callback',
        client_id: 'client-123',
        client_secret: 'secret-client-key',
        access_token: 'token-789',
      };
      const result = redactLogData(payload) as Record<string, unknown>;
      expect(result.code).toBe('auth-code-123');
      expect(result.client_secret).toBe('[REDACTED]');
      expect(result.access_token).toBe('[REDACTED]');
    });

    it('should handle error responses with sensitive data', () => {
      const errorLog = {
        errorMessage: 'Database connection failed',
        connectionString: 'postgres://user:password123@db.example.com:5432/soter',
        userId: 'user-123',
        email: 'user@example.com',
      };
      const result = redactLogData(errorLog) as Record<string, unknown>;
      expect(result.errorMessage).toBe('Database connection failed');
      expect(result.connectionString).toContain('[REDACTED]');
      expect(result.email).toContain('[EMAIL]');
    });

    it('should handle mixed sensitive and public data in logs', () => {
      const logEntry = {
        timestamp: '2024-01-01T00:00:00Z',
        requestId: 'req-789',
        userId: 'user-456',
        method: 'POST',
        route: '/api/verify',
        statusCode: 200,
        latency_ms: 150,
        requestBody: {
          email: 'test@example.com',
          phoneNumber: '555-123-4567',
        },
        responseBody: {
          success: true,
          verificationId: 'verify-123',
        },
        apiKey: 'sk-live-1234567890',
      };

      const result = redactLogData(logEntry) as Record<string, unknown>;
      expect(result.timestamp).toBe('2024-01-01T00:00:00Z');
      expect(result.requestId).toBe('req-789');
      expect(result.statusCode).toBe(200);
      expect(result.latency_ms).toBe(150);
      expect(result.apiKey).toBe('[REDACTED]');

      const reqBody = result.requestBody as Record<string, unknown>;
      expect(reqBody.email).toContain('[EMAIL]');
      expect(reqBody.phoneNumber).toContain('[PHONE]');

      const resBody = result.responseBody as Record<string, unknown>;
      expect(resBody.success).toBe(true);
      expect(resBody.verificationId).toBe('verify-123');
    });
  });
});
