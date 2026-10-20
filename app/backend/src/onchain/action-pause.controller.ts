import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Version,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import {
  AdminActionRequest,
  getAdminActionActor,
  getAdminActionCorrelationId,
} from '../audit/admin-action-logger.service';
import { ActionPauseService } from './action-pause.service';
import { PAUSABLE_ACTIONS } from './onchain.adapter';

/**
 * Shape populated by ApiKeyGuard on `request.user`. API-key callers are
 * identified by `apiKeyId`; JWT callers carry `id`/`sub`.
 */
const ACTION_PARAM = {
  name: 'action',
  enum: PAUSABLE_ACTIONS,
  description: 'Contract action to pause or unpause.',
} as const;

@Controller('admin/pause/actions')
@ApiTags('Admin Pause Controls')
@ApiBearerAuth('JWT-auth')
export class ActionPauseController {
  constructor(private readonly actionPauseService: ActionPauseService) {}

  @Get()
  @Version('1')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Read global and per-action pause state',
    description:
      'Returns whether the contract is globally paused and whether each ' +
      'pausable action is currently blocked. A global pause reports every ' +
      'action as paused.',
  })
  @ApiOkResponse({
    description: 'Current pause state.',
    schema: {
      example: {
        globallyPaused: false,
        actions: { create: false, claim: true, withdraw: false, refund: false },
        timestamp: '2026-10-19T00:00:00.000Z',
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
    return this.actionPauseService.getStatus();
  }

  @Post(':action/pause')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiParam(ACTION_PARAM)
  @ApiOperation({
    summary: 'Pause a single contract action',
    description:
      'Blocks one action path (create, claim, withdraw, or refund) without ' +
      'pausing the whole contract. Recorded in the audit chain with the actor ' +
      'and transaction hash.',
  })
  @ApiOkResponse({
    description: 'Action paused and recorded in the audit log.',
    schema: {
      example: {
        action: 'claim',
        transactionHash: 'A1B2C3...',
        isPaused: true,
        globallyPaused: false,
        timestamp: '2026-10-19T00:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Unknown action.' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiConflictResponse({
    description: 'The contract did not record the pause.',
  })
  async pause(
    @Param('action') action: string,
    @Req() request: AdminActionRequest,
  ) {
    const correlationId = getAdminActionCorrelationId(request);
    return this.actionPauseService.pause(
      {
        actorId: getAdminActionActor(request),
        ...(correlationId ? { correlationId } : {}),
      },
      action,
    );
  }

  @Post(':action/unpause')
  @Version('1')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiParam(ACTION_PARAM)
  @ApiOperation({
    summary: 'Unpause a single contract action',
    description:
      'Lifts a per-action pause. Does not lift a global pause: while the ' +
      'contract is globally paused the action stays blocked and the response ' +
      'reports `isPaused: true, globallyPaused: true`. Recorded in the audit ' +
      'chain with the actor and transaction hash.',
  })
  @ApiOkResponse({
    description: 'Action unpaused and recorded in the audit log.',
  })
  @ApiBadRequestResponse({ description: 'Unknown action.' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiConflictResponse({
    description:
      'The contract still reports the action as paused without a global pause.',
  })
  async unpause(
    @Param('action') action: string,
    @Req() request: AdminActionRequest,
  ) {
    const correlationId = getAdminActionCorrelationId(request);
    return this.actionPauseService.unpause(
      {
        actorId: getAdminActionActor(request),
        ...(correlationId ? { correlationId } : {}),
      },
      action,
    );
  }
}
