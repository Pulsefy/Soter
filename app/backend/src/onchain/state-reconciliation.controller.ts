import { Controller, Post, Get, Version, Roles } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { StateReconciliationService } from './state-reconciliation.service';
import { AppRole } from '../auth/app-role.enum';

@ApiTags('State Reconciliation')
@Controller('admin/reconciliation')
export class StateReconciliationController {
  constructor(
    private readonly reconciliationService: StateReconciliationService,
  ) {}

  @Post('trigger')
  @Version('1')
  // @Roles(AppRole.admin) // Uncomment if auth is ready
  @ApiOperation({
    summary: 'Trigger manual state reconciliation',
    description:
      'Immediately compare on-chain state with backend cached state and record any drift.',
  })
  @ApiOkResponse({
    description: 'Reconciliation completed successfully.',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  async triggerReconciliation() {
    return this.reconciliationService.reconcileAll();
  }

  @Get('logs')
  @Version('1')
  // @Roles(AppRole.admin) // Uncomment if auth is ready
  @ApiOperation({
    summary: 'Get drift incident logs',
    description: 'Retrieve the most recent drift incident records.',
  })
  @ApiOkResponse({
    description: 'Drift logs retrieved successfully.',
  })
  async getDriftLogs() {
    return this.reconciliationService.getDriftLogs();
  }
}
