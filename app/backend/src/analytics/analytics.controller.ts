/*
 * @file analytics.controller.ts
 *
 * Exposes the analytics endpoints consumed by the global dashboard:
 *
 *   GET /analytics/global-stats             - aggregated totals + breakdowns
 *   GET /analytics/map-data                 - anonymised Leaflet map points
 *   GET /analytics/verification-throughput - verification throughput aggregates
 *
 * All endpoints are read-only and accept optional query parameters for
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
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { AnalyticsService } from './analytics.service';
import {
  GlobalStatsDto,
  MapDataDto,
  GeoJsonFeatureCollection,
  GlobalStatsQuery,
  MapDataQuery,
  ContractAggregatesDto,
  ContractAggregatesQuery,
  VerificationThroughputDto,
  VerificationThroughputQuery,
} from './dto';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  @Public()
  @Get('global-stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get global distribution statistics',
    description:
      'Returns aggregated totals and breakdowns by token and region for the dashboard.',
  })
  @ApiOkResponse({
    description: 'Global statistics retrieved successfully.',
    type: GlobalStatsDto,
  })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'region', required: false, type: String })
  @ApiQuery({ name: 'token', required: false, type: String })
  async getGlobalStats(
    @Query('from') from?: string,
    @Query('to') to: string,
    @Query('region') region?: string,
    @Query('token') token?: string,
  ): Promise<GlobalStatsDto> {
    const query: GlobalStatsQuery = { from, to, region, token };
    this.logger.log(`GET /analytics/global-stats ${JSON.stringify(query)}`);
    return this.analyticsService.getGlobalStats(query);
  }

  @Public()
  @Get('map-data')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get map data points',
    description:
      'Returns a list of distribution points with coordinates and amounts for map visualization.',
  })
  @ApiOkResponse({
    description: 'Map data points retrieved successfully.',
    type: MapDataDto,
  })
  @ApiQuery({ name: 'region', required: false, type: String })
  @ApiQuery({ name: 'token', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  async getMapData(
    @Query('region') region?: string,
    @Query('token') token?: string,
    @Query('status') status?: string,
  ): Promise<MapDataDto> {
    const query: MapDataQuery = { region, token, status };
    this.logger.log(`GET /analytics/map-data ${JSON.stringify(query)}`);
    return this.analyticsService.getMapData(query);
  }

  @Public()
  @Get('map-anonymized')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get anonymized map data (GeoJSON)',
    description:
      'Returns distribution data in GeoJSON format with anonymized locations for privacy.',
  })
  @ApiOkResponse({
    description: 'Anonymized GeoJSON data retrieved successfully.',
    type: GeoJsonFeatureCollection,
  })
  @ApiQuery({ name: 'region', required: false, type: String })
  @ApiQuery({ name: 'token', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  async getMapAnonymizedData(
    @Query('region') region?: string,
    @Query('token') token?: string,
    @Query('status') status?: string,
  ): Promise<GeoJsonFeatureCollection> {
    const query: MapDataQuery = { region, token, status };
    this.logger.log(`GET /analytics/map-anonymized ${JSON.stringify(query)}`);
    return this.analyticsService.getMapAnonymizedData(query);
  }

  @Public()
  @Get('contract-aggregates')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get contract aggregates',
    description:
      'Returns aggregated statistics from the onchain contract including total committed, claimed, and expired amounts.',
  })
  @ApiOkResponse({
    description: 'Contract aggregates retrieved successfully.',
    type: ContractAggregatesDto,
  })
  @ApiQuery({ name: 'token', required: false, type: String })
  async getContractAggregates(
    @Query('token') token?: string,
  ): Promise<ContractAggregatesDto> {
    const query: ContractAggregatesQuery = { token };
    this.logger.log(
      `GET /analytics/contract-aggregates ${JSON.stringify(query)}`,
    );
    return this.analyticsService.getContractAggregates(query);
  }

  @Public()
  @Get('verification-throughput')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get verification throughput aggregates',
    description:
      'Returns claims processed per hour, outcome distribution, and average time-to-decision over a time window.',
  })
  @ApiOkResponse({
    description: 'Verification throughput aggregates retrieved successfully.',
    type: VerificationThroughputDto,
  })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  async getVerificationThroughput(
    @Query('from') from?: string,
    @Query('to') to: string,
  ): Promise<VerificationThroughputDto> {
    const query: VerificationThroughputQuery = { from, to };
    this.logger.log(
      `GET /analytics/verification-throughput ${JSON.stringify(query)}`,
    );
    return this.analyticsService.getVerificationThroughput(query);
  }
}
