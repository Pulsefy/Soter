import { Controller, Get, Query, Version } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { API_VERSIONS } from '../common/constants/api-version.constants';
import { Public } from '../common/decorators/public.decorator';
import {
  ReleaseConfigQueryDto,
  ReleaseConfigResponseDto,
  ReleasePlatform,
} from './dto/release-config.dto';
import { ReleaseConfigService } from './release-config.service';

@ApiTags('Release Config')
@Controller('config')
export class ReleaseConfigController {
  constructor(private readonly releaseConfigService: ReleaseConfigService) {}

  @Public()
  @Get('version')
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'Get platform-specific release configuration',
    description:
      'Returns backend-managed version information, release notes, minimum supported version, and force-upgrade requirements.',
  })
  @ApiQuery({
    name: 'platform',
    required: false,
    enum: ReleasePlatform,
    example: ReleasePlatform.WEB,
  })
  @ApiOkResponse({
    description: 'Release configuration returned successfully.',
    type: ReleaseConfigResponseDto,
  })
  getConfigVersion(
    @Query() query: ReleaseConfigQueryDto,
  ): ReleaseConfigResponseDto {
    return this.releaseConfigService.getConfig(
      query.platform ?? ReleasePlatform.WEB,
    );
  }
}
