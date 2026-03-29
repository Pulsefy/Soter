// import { Controller, Get, Version } from '@nestjs/common';
// import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
// import { API_VERSIONS } from '../common/constants/api-version.constants';
// import { Public } from '../common/decorators/public.decorator';
// import { AnalyticsService, MapDataPoint } from './analytics.service';

// @ApiTags('Analytics')
// @Controller('analytics')
// export class AnalyticsController {
//   constructor(private readonly analyticsService: AnalyticsService) {}

//   @Public()
//   @Get('map-data')
//   @Version(API_VERSIONS.V1)
//   @ApiOperation({
//     summary: 'Get anonymized distribution data for the global dashboard map',
//   })
//   @ApiOkResponse({
//     description: 'List of anonymized aid package distribution points.',
//     schema: {
//       example: [
//         {
//           id: 'pkg-001',
//           lat: 6.5244,
//           lng: 3.3792,
//           amount: 250,
//           token: 'USDC',
//           status: 'delivered',
//         },
//       ],
//     },
//   })
//   getMapData(): MapDataPoint[] {
//     return this.analyticsService.getMapData();
//   }
// }

/**
 * @file analytics.controller.ts
 *
 * Exposes the two analytics endpoints consumed by the global dashboard:
 *
 *   GET /analytics/global-stats   — aggregated totals + breakdowns
 *   GET /analytics/map-data       — anonymised Leaflet map points
 *
 * Both endpoints are read-only and accept optional query parameters for
 * filtering by region, token type, and timeframe.
 */

import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import {
  GlobalStatsDto,
  GlobalStatsQuery,
  MapDataDto,
  MapDataQuery,
} from './dto';

@Controller('analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

 
  @Get('global-stats')
  @HttpCode(HttpStatus.OK)
  async getGlobalStats(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('region') region?: string,
    @Query('token') token?: string,
  ): Promise<GlobalStatsDto> {
    const query: GlobalStatsQuery = { from, to, region, token };
    this.logger.log(`GET /analytics/global-stats ${JSON.stringify(query)}`);
    return this.analyticsService.getGlobalStats(query);
  }

 
  @Get('map-data')
  @HttpCode(HttpStatus.OK)
  async getMapData(
    @Query('region') region?: string,
    @Query('token') token?: string,
    @Query('status') status?: string,
  ): Promise<MapDataDto> {
    const query: MapDataQuery = { region, token, status };
    this.logger.log(`GET /analytics/map-data ${JSON.stringify(query)}`);
    return this.analyticsService.getMapData(query);
  }
}