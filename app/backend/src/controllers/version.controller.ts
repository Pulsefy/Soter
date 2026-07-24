import { Controller, Get } from '@nestjs/common';
import { VersionService } from '../../services/version.service';

@Controller('api')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Get('version')
  getVersion() {
    return this.versionService.getVersionConfig();
  }
}
