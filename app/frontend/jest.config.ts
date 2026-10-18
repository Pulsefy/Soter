import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  // Most suites assert on Node web-platform primitives (Blob/File/Response),
  // so `node` stays the default. Suites that need a DOM opt in with a
  // `/** @jest-environment jsdom */` docblock; suites that need both use the
  // jsdom environment extended in jest.environment.ts.
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

export default config;
