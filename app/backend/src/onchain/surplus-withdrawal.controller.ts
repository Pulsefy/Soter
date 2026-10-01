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
import { SurplusWithdrawalService } from './surplus-withdrawal.service';
import { ProposeSurplusWithdrawalDto } from './dto/surplus-withdrawal.dto';

/**
 * Shape populated by ApiKeyGuard on `request.user`. API-key callers are
 * identified by `apiKeyId`; JWT callers carry `id`/`sub`.
 */
interface SurplusWithdrawalRequest {
  user?: { id?: string; sub?: string; apiKeyId?: string };
}

@Controller('admin/surplus-withdrawal')
@ApiTags('Surplus Withdrawal')
@ApiBearerAuth('JWT-auth')
export class SurplusWithdrawalController {
  constructor(
    private readonly surplusWithdrawalService: SurplusWithdrawalService,
  ) {}

  /**
   * Resolve the audit actor. Mirrors the fallback chain used by
   * LoggingInterceptor so API-key and JWT callers are both attributable.
   */
  private actorId(request: SurplusWithdrawalRequest): string {
    return (
      request.user?.sub ??
      request.user?.id ??
      request.user?.apiKeyId ??
      'unknown'
    );
  }

  @Get('status')
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Read the pending surplus withdrawal and its timelock',
    description:
      'Returns the proposal recorded by the propose endpoint, or `null` when ' +
      'none exists, plus the seconds remaining on its timelock. Read-only: ' +
      'this is the endpoint to poll during the delay window.',
  })
  @ApiOkResponse({
    description: 'Current surplus withdrawal state.',
    schema: {
      example: {
        contractId: 'CBUILDERSEXAMPLECONTRACTID000000000000000000',
        pendingWithdrawal: {
          to: 'GDESTINATIONADDRESS000000000000000000000000000000000',
          token: 'CA3D5KRYM6CB7OWQ6TWYRR3Z4ZT7B32DRH2V2385ST2QY4QCP2CAF5Y',
          amount: '1000000000',
          executableAt: 1789000000,
        },
        timelockRemainingSeconds: 43200,
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
  async getStatus() {
    return this.surplusWithdrawalService.getStatus();
  }

  @Post('propose')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Propose a surplus withdrawal (starts the timelock)',
    description:
      'Records the intent to move `amount` of `token` to `to` and starts the ' +
      "contract's delay window. No funds move. Only one proposal may be " +
      'pending at a time; cancel it before proposing another. Recorded in the ' +
      'audit chain with the actor, destination, amount and the timestamp the ' +
      'withdrawal becomes executable.',
  })
  @ApiOkResponse({
    description: 'Proposal recorded and the timelock started.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiConflictResponse({
    description: 'A surplus withdrawal is already pending.',
  })
  async propose(
    @Body() dto: ProposeSurplusWithdrawalDto,
    @Req() request: SurplusWithdrawalRequest,
  ) {
    return this.surplusWithdrawalService.propose(
      { actorId: this.actorId(request) },
      dto,
    );
  }

  @Post('cancel')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a pending surplus withdrawal',
    description:
      'Abandons the outstanding proposal. No funds are transferred. Use this ' +
      'when the destination or amount is wrong, or when the proposal is no ' +
      'longer wanted before it matures. Recorded in the audit chain with the ' +
      'cancelling actor and the withdrawn proposal.',
  })
  @ApiOkResponse({
    description: 'Proposal cancelled and recorded in the audit log.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async cancel(@Req() request: SurplusWithdrawalRequest) {
    return this.surplusWithdrawalService.cancel({
      actorId: this.actorId(request),
    });
  }

  @Post('execute')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Execute a matured surplus withdrawal',
    description:
      'Transfers the proposed funds and clears the proposal. Signed with the ' +
      'configured SOROBAN_ADMIN_SECRET_KEY. Rejected with a distinct 409 ' +
      "carrying the remaining wait while the contract's delay is still " +
      'running, so a premature attempt is never mistaken for a real failure. ' +
      'Recorded in the audit chain with the executing actor and the released ' +
      'destination and amount.',
  })
  @ApiOkResponse({
    description: 'Withdrawal executed and recorded in the audit log.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiConflictResponse({
    description:
      'The timelock has not elapsed, or the contract still reports the proposal as pending after execution.',
  })
  async execute(@Req() request: SurplusWithdrawalRequest) {
    return this.surplusWithdrawalService.execute({
      actorId: this.actorId(request),
    });
  }
}
