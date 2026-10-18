/**
 * Global Jest setup (runs after the test framework).
 *
 * Registers the `@testing-library/jest-dom` matchers (`toBeInTheDocument`,
 * `toBeDisabled`, ...) once for every suite instead of importing the package in
 * each test file. The jsdom environment itself is customised in
 * jest.environment.ts.
 */
import '@testing-library/jest-dom';
