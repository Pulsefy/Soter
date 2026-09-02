/**
 * Common Module
 *
 * Shared utilities, constants, decorators, filters, DTOs, and helpers used across the application.
 */

// Constants & Error Catalog
export * from './constants/api-version.constants';
export * from './constants/error-codes';
export * from './constants/integration-error-codes';

// DTOs
export * from './dto/error-response.dto';
export * from './dto/api-response.dto';

// Filters
export * from './filters/http-exception.filter';

// Decorators
export * from './decorators/deprecated.decorator';
export * from './decorators/standard-error.decorator';

// Interceptors
export * from './interceptors/deprecation.interceptor';

// Budget
export * from './budget/budget.service';
