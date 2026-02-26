/**
 * Test data factories for creating deterministic test data
 */

// Simple deterministic data generator
class TestDataGenerator {
  private static counter = 1;

  static nextId(): string {
    return `test_${this.counter++}_${Date.now()}`;
  }

  static nextEmail(): string {
    return `user${this.counter++}@test.example.com`;
  }

  static nextPhone(): string {
    return `+123456789${this.counter++}`;
  }

  static nextString(prefix: string = 'test'): string {
    return `${prefix}_${this.counter++}_${Date.now()}`;
  }

  static nextNumber(min: number = 1, max: number = 1000): number {
    return (this.counter++ % (max - min + 1)) + min;
  }

  static nextDate(): Date {
    return new Date(Date.now() + (this.counter++ * 1000));
  }
}

export interface TestUser {
  id: string;
  email: string;
  phone?: string;
  role: string;
}

export interface TestVerificationSession {
  id: string;
  channel: 'email' | 'phone';
  identifier: string;
  code: string;
  status: 'pending' | 'completed' | 'expired';
  expiresAt: Date;
}

export interface TestClaim {
  id: string;
  campaignId: string;
  amount: number;
  recipientRef: string;
  status: 'requested' | 'verified' | 'approved' | 'disbursed' | 'archived';
}

export interface TestCampaign {
  id: string;
  name: string;
  budget: number;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
}

/**
 * Factory for creating test users
 */
export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: TestDataGenerator.nextId(),
    email: TestDataGenerator.nextEmail(),
    phone: TestDataGenerator.nextPhone(),
    role: 'user',
    ...overrides,
  };
}

/**
 * Factory for creating test verification sessions
 */
export function createTestVerificationSession(
  overrides: Partial<TestVerificationSession> = {},
): TestVerificationSession {
  const identifier = TestDataGenerator.nextEmail();
  
  return {
    id: TestDataGenerator.nextId(),
    channel: 'email',
    identifier,
    code: '123456',
    status: 'pending',
    expiresAt: TestDataGenerator.nextDate(),
    ...overrides,
  };
}

/**
 * Factory for creating test claims
 */
export function createTestClaim(overrides: Partial<TestClaim> = {}): TestClaim {
  return {
    id: TestDataGenerator.nextId(),
    campaignId: TestDataGenerator.nextId(),
    amount: TestDataGenerator.nextNumber(100, 1000),
    recipientRef: TestDataGenerator.nextId(),
    status: 'requested',
    ...overrides,
  };
}

/**
 * Factory for creating test campaigns
 */
export function createTestCampaign(overrides: Partial<TestCampaign> = {}): TestCampaign {
  return {
    id: TestDataGenerator.nextId(),
    name: TestDataGenerator.nextString('campaign') + ' Aid Campaign',
    budget: TestDataGenerator.nextNumber(10000, 100000),
    status: 'active',
    ...overrides,
  };
}

/**
 * Deterministic test data for consistent testing
 */
export const DETERMINISTIC_TEST_DATA = {
  user: {
    id: 'test-user-123',
    email: 'test@example.com',
    phone: '+1234567890',
    role: 'user',
  },
  verificationSession: {
    id: 'test-session-123',
    channel: 'email' as const,
    identifier: 'test@example.com',
    code: '123456',
    status: 'pending' as const,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  },
  claim: {
    id: 'test-claim-123',
    campaignId: 'test-campaign-123',
    amount: 500.00,
    recipientRef: 'test-recipient-123',
    status: 'requested' as const,
  },
  campaign: {
    id: 'test-campaign-123',
    name: 'Test Aid Campaign',
    budget: 50000.00,
    status: 'active' as const,
  },
  apiKey: 'test-api-key-for-e2e-testing',
};
