import { SetMetadata } from '@nestjs/common';
import { ApiKeyScope } from './api-key-scope.enum';

export const SCOPES_KEY = 'apiKeyScopes';
export const Scopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(SCOPES_KEY, scopes);
