import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  Version,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { AppRole } from '../auth/app-role.enum';
import { Roles } from '../auth/roles.decorator';
import {
  AdminTransferService,
  PendingAdminResult,
} from './admin-transfer.service';
import {
  AcceptAdminResult,
  CancelAdminTransferResult,
  TransferAdminResult,
} from './onchain.adapter';

/**
 * Resolve the audit actor from the authenticated request.
 *
 * JWT-auth requests carry `id`/`sub`/`email`; API-key requests carry
 * `apiKeyId`. Falls back to `unknown` so an audit entry is never dropped.
 */
function resolveActorId(req: ExpressRequest): string {
  return (
    req.user?.id ??
    req.user?.sub ??
    req.user?.email ??
    req.user?.apiKeyId ??
    'unknown'
  );
}

@ApiTags('Onchain Admin Transfer')
@Controller('admin/onchain/admin-transfer')
export class AdminTransferController {
  constructor(private readonly adminTransferService: AdminTransferService) {}

  @Post('transfer')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initiate a two-step contract admin transfer',
    description:
      'Proposes a new admin for the aid-escrow contract (`transfer_admin`). The nominated address must call the accept endpoint to complete the rotation. Requires the admin role.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        newAdmin: {
          type: 'string',
          description: 'Stellar address to nominate as the next contract admin',
        },
      },
      required: ['newAdmin'],
    },
  })
  @ApiOkResponse({ description: 'Admin transfer proposed.' })
  @ApiBadRequestResponse({ description: 'Invalid request parameters.' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async initiateTransfer(
    @Body() body: { newAdmin?: string },
    @Request() req: ExpressRequest,
  ): Promise<TransferAdminResult> {
    return this.adminTransferService.initiateTransfer({
      newAdmin: body?.newAdmin ?? '',
      actorId: resolveActorId(req),
    });
  }

  @Post('accept')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a pending contract admin transfer',
    description:
      'Confirms the in-flight admin transfer (`accept_admin`). The configured admin signer must be the nominated address. Requires the admin role.',
  })
  @ApiOkResponse({ description: 'Admin transfer accepted.' })
  @ApiBadRequestResponse({
    description: 'No pending admin transfer to accept.',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async acceptTransfer(
    @Request() req: ExpressRequest,
  ): Promise<AcceptAdminResult> {
    return this.adminTransferService.acceptTransfer(resolveActorId(req));
  }

  @Post('cancel')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a pending contract admin transfer',
    description:
      'Aborts an in-flight admin transfer before it is accepted (`cancel_admin_transfer`). Requires the admin role.',
  })
  @ApiOkResponse({ description: 'Admin transfer cancelled.' })
  @ApiBadRequestResponse({
    description: 'No pending admin transfer to cancel.',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async cancelTransfer(
    @Request() req: ExpressRequest,
  ): Promise<CancelAdminTransferResult> {
    return this.adminTransferService.cancelTransfer(resolveActorId(req));
  }

  @Get('pending')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get the pending contract admin transfer',
    description:
      'Returns the address currently nominated to become admin, or `null` when no transfer is in flight.',
  })
  @ApiOkResponse({ description: 'Pending admin retrieved.' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async getPendingAdmin(): Promise<PendingAdminResult> {
    return this.adminTransferService.getPendingAdmin();
  }
}
