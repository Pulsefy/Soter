import {
  Controller,
  Delete,
  InternalServerErrorException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AppRole } from '../auth/app-role.enum';
import { Roles } from '../auth/roles.decorator';
import { SandboxGuard } from './sandbox.guard';
import { SeedService } from './seed.service';

@Controller({ path: 'admin/sandbox', version: '1' })
@Roles(AppRole.admin)
@UseGuards(SandboxGuard)
export class SandboxController {
  constructor(private readonly seedService: SeedService) {}

  @Post('seed/tenant')
  seedTenant() {
    return this.seedService.seedTenant();
  }

  @Post('seed/campaigns')
  seedCampaigns() {
    return this.seedService.seedCampaigns();
  }

  @Post('seed/claims')
  seedClaims() {
    return this.seedService.seedClaims();
  }

  @Post('seed')
  async seedAll() {
    try {
      return await this.seedService.seedAll();
    } catch (err) {
      throw new InternalServerErrorException((err as Error).message);
    }
  }

  @Delete('seed')
  resetSeed() {
    return this.seedService.resetSeed();
  }
}
