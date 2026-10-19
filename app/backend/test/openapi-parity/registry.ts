/**
 * Endpoints covered by the request-body parity check.
 *
 * To cover a new endpoint:
 *  1. Add its controller to CONTROLLERS (once per controller).
 *  2. Add one line to ENDPOINTS with the HTTP method, the path exactly as it
 *     appears in the OpenAPI document (`/api/v1/...`, `{id}` style params) and
 *     the DTO class used by its `@Body()`.
 *
 * See docs/openapi-dto-parity.md for the full walkthrough.
 */
import type { Type } from '@nestjs/common';

import { ApiKeysController } from '../../src/api-keys/api-keys.controller';
import { CreateApiKeyDto } from '../../src/api-keys/dto/create-api-key.dto';
import { RevokeApiKeyDto } from '../../src/api-keys/dto/revoke-api-key.dto';
import { RotateApiKeyDto } from '../../src/api-keys/dto/rotate-api-key.dto';
import { CampaignsController } from '../../src/campaigns/campaigns.controller';
import { CreateCampaignDto } from '../../src/campaigns/dto/create-campaign.dto';
import { UpdateCampaignDto } from '../../src/campaigns/dto/update-campaign.dto';
import { CancelClaimDto } from '../../src/claims/dto/cancel-claim.dto';
import { SendReceiptShareDto } from '../../src/claims/dto/claim-receipt.dto';
import { CreateClaimDto } from '../../src/claims/dto/create-claim.dto';
import { DisburseClaimDto } from '../../src/claims/dto/disburse-claim.dto';
import { ReissueClaimDto } from '../../src/claims/dto/reissue-claim.dto';
import { ClaimsController } from '../../src/claims/claims.controller';
import { CreateInternalNoteDto } from '../../src/common/dto/create-internal-note.dto';
import { DeviceTokensController } from '../../src/device-tokens/device-tokens.controller';
import { RegisterDeviceTokenDto } from '../../src/device-tokens/dto/register-device-token.dto';
import { RevokeDeviceTokenDto } from '../../src/device-tokens/dto/revoke-device-token.dto';
import type { ParityEndpoint } from './dto-parity';

export const CONTROLLERS: Type<unknown>[] = [
  CampaignsController,
  ApiKeysController,
  DeviceTokensController,
  ClaimsController,
];

export const ENDPOINTS: ParityEndpoint[] = [
  // campaigns
  { method: 'post', path: '/api/v1/campaigns', dto: CreateCampaignDto },
  { method: 'patch', path: '/api/v1/campaigns/{id}', dto: UpdateCampaignDto },
  // api keys
  { method: 'post', path: '/api/v1/api-keys', dto: CreateApiKeyDto },
  {
    method: 'post',
    path: '/api/v1/api-keys/{id}/rotate',
    dto: RotateApiKeyDto,
  },
  {
    method: 'post',
    path: '/api/v1/api-keys/{id}/revoke',
    dto: RevokeApiKeyDto,
  },
  // device tokens
  {
    method: 'post',
    path: '/api/v1/device-tokens',
    dto: RegisterDeviceTokenDto,
  },
  {
    method: 'post',
    path: '/api/v1/device-tokens/{id}/revoke',
    dto: RevokeDeviceTokenDto,
  },
  // claims
  { method: 'post', path: '/api/v1/claims', dto: CreateClaimDto },
  {
    method: 'post',
    path: '/api/v1/claims/{id}/disburse',
    dto: DisburseClaimDto,
  },
  {
    method: 'post',
    path: '/api/v1/claims/{id}/receipt/share',
    dto: SendReceiptShareDto,
  },
  {
    method: 'post',
    path: '/api/v1/claims/{id}/notes',
    dto: CreateInternalNoteDto,
  },
  { method: 'post', path: '/api/v1/claims/{id}/cancel', dto: CancelClaimDto },
  { method: 'post', path: '/api/v1/claims/{id}/reissue', dto: ReissueClaimDto },
];
