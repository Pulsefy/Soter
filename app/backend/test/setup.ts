import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Set test-specific environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce noise in test output

// Increase timeout for database operations and HTTP requests
jest.setTimeout(30000);

// Global test setup hooks
beforeAll(async () => {
  // Ensure clean test environment
  console.log('🚀 Starting E2E test suite');
});

afterAll(async () => {
  // Cleanup after all tests
  console.log('✅ E2E test suite completed');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});
