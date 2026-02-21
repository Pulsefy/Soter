import {
  Controller,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Version,
} from '@nestjs/common';
import { AidService } from './aid.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Aid')
@Controller('aid')
export class AidController {
  constructor(private readonly aidService: AidService) {}

  @Post('campaign')
  @Version('1')
  @ApiOperation({ summary: 'Create a new campaign' })
  async createCampaign(@Body() data: Record<string, unknown>) {
    return this.aidService.createCampaign(data);
  }

  @Patch('campaign/:id')
  @Version('1')
  @ApiOperation({ summary: 'Update a campaign' })
  async updateCampaign(
    @Param('id') id: string,
    @Body() data: Record<string, unknown>,
  ) {
    return this.aidService.updateCampaign(id, data);
  }

  @Delete('campaign/:id')
  @Version('1')
  @ApiOperation({ summary: 'Archive a campaign' })
  async archiveCampaign(@Param('id') id: string) {
    return this.aidService.archiveCampaign(id);
  }

  @Post('claim/:id/transition')
  @Version('1')
  @ApiOperation({ summary: 'Transition a claim status' })
  async transitionClaim(
    @Param('id') id: string,
    @Body('from') from: string,
    @Body('to') to: string,
  ) {
    return this.aidService.transitionClaim(id, from, to);
  }
}
