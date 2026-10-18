import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SandboxService } from './sandbox.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Sandbox')
@Controller('sandbox')
export class SandboxController {
  constructor(private readonly sandboxService: SandboxService) {}

  @Post('reset-demo-seed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset demo seed data (Testnet environments only)',
    description:
      'Deletes all existing demo data and recreates a deterministic demo state. This endpoint is only available in development, test, and sandbox environments.',
  })
  @ApiResponse({
    status: 200,
    description: 'Demo seed data reset successfully.',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden. This operation is not allowed in this environment.',
  })
  @Public() // Allow unauthenticated access, as the service handles environment-based authorization
  async resetDemoSeed(): Promise<{ message: string }> {
    await this.sandboxService.resetDemoState();
    return { message: 'Demo seed data reset successfully.' };
  }
}
