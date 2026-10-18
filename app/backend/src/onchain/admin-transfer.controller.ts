import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Version,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { AdminTransferService } from './admin-transfer.service';
import { ProposeAdminTransferDto } from './dto/admin-transfer.dto';

/**
 * Shape populated by ApiKeyGuard on `request.user`. API-key callers are
 * identified by `apiKeyId`; JWT callers carry `id`/`sub`.
 */
interface AdminTransferRequest {
  user?: { id?: string; sub?: string; apiKeyId?: string };
}

@Controller('admin/transfer')
@ApiTags('Admin Transfer')
@ApiBearerAuth('JWT-auth')
export class AdminTransferController {
  constructor(private readonly adminTransferService: AdminTransferService) {}

  /**
   * Resolve the audit actor. Mirrors the fallback chain used by
   * LoggingInterceptor so API-key and JWT callers are both attributable.
   */
  private actorId(request: AdminTransferRequest): string {
    return (
      request.user?.sub ??
      request.user?.id ??
      request.user?.apiKeyId ??
      'unknown'
    );
  }

  @Get('state')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Read the current admin and any transfer in progress',
    description:
      'Returns the contract admin plus the pending admin nominated by a ' +
      'previous proposal, or `null` when no transfer is in progress.',
  })
  @ApiOkResponse({
    description: 'Current admin state.',
    schema: {
      example: {
        adminAddress:
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        pendingAdminAddress: null,
        timestamp: '2026-09-29T00:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async getState() {
    return this.adminTransferService.getState();
  }

  @Post('propose')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Propose a new contract admin (step 1 of 2)',
    description:
      'Nominates `newAdminAddress` as the pending admin. The current admin ' +
      'keeps full control until the nominee calls the accept endpoint, so a ' +
      'compromised session cannot rotate the admin in a single call. ' +
      'Recorded in the audit chain with the actor and both addresses.',
  })
  @ApiOkResponse({
    description: 'Transfer proposed and recorded in the audit log.',
    schema: {
      example: {
        contractId: 'CBUILDERSEXAMPLECONTRACTID000000000000000000',
        transactionHash: 'A1B2C3...',
        adminAddress:
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        pendingAdminAddress:
          'GDESTINATIONADDRESS000000000000000000000000000000000',
        timestamp: '2026-09-29T00:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiConflictResponse({
    description: 'The contract did not record the nomination.',
  })
  async propose(
    @Body() dto: ProposeAdminTransferDto,
    @Req() request: AdminTransferRequest,
  ) {
    return this.adminTransferService.propose(
      { actorId: this.actorId(request) },
      dto,
    );
  }

  @Post('accept')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a pending admin transfer (step 2 of 2)',
    description:
      'Completes a transfer proposed via the propose endpoint. Only succeeds ' +
      'while a proposal is outstanding. Recorded in the audit chain with the ' +
      'accepting actor and the incoming and outgoing admin addresses. ' +
      'Signed with the configured SOROBAN_ADMIN_SECRET_KEY, so the backend ' +
      'can only accept when that key is the pending admin.',
  })
  @ApiOkResponse({
    description: 'Transfer accepted and recorded in the audit log.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiConflictResponse({
    description: 'The contract still reports a pending admin after acceptance.',
  })
  async accept(@Req() request: AdminTransferRequest) {
    return this.adminTransferService.accept({
      actorId: this.actorId(request),
    });
  }

  @Post('cancel')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a pending admin transfer',
    description:
      'Abandons an outstanding proposal, leaving the current admin in place. ' +
      'Use this when a transfer is proposed in error or the nominee is ' +
      'unavailable. Recorded in the audit chain with the cancelling actor and ' +
      'the withdrawn nominee.',
  })
  @ApiOkResponse({
    description: 'Transfer cancelled and recorded in the audit log.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiConflictResponse({
    description:
      'The contract still reports a pending admin after cancellation.',
  })
  async cancel(@Req() request: AdminTransferRequest) {
    return this.adminTransferService.cancel({
      actorId: this.actorId(request),
    });
  }
}
