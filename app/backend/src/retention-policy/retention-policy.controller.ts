import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { RetentionPolicyService } from './retention-policy.service';
import { CreateRetentionPolicyDto } from './dto/create-retention-policy.dto';
import { UpdateRetentionPolicyDto } from './dto/update-retention-policy.dto';

@ApiTags('Retention Policy')
@ApiBearerAuth('JWT-auth')
@Controller('retention-policy')
export class RetentionPolicyController {
  constructor(private readonly service: RetentionPolicyService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a retention policy',
    description:
      'Defines a retention window and purge strategy for a specific entity type.',
  })
  create(@Body() dto: CreateRetentionPolicyDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all retention policies',
    description: 'Returns all configured retention policies, ordered by entity.',
  })
  @ApiQuery({ name: 'entity', required: false, description: 'Filter by entity name' })
  findAll() {
    return this.service.findAll();
  }

  @Get('entities')
  @ApiOperation({
    summary: 'List supported entity names',
    description:
      'Returns the list of entity types that support retention policies.',
  })
  getSupportedEntities() {
    return { entities: this.service.getSupportedEntities() };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single retention policy',
  })
  @ApiParam({ name: 'id', description: 'Retention policy ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update a retention policy',
    description:
      'Partially update a retention policy. Changes take effect on the next purge run.',
  })
  @ApiParam({ name: 'id', description: 'Retention policy ID' })
  update(@Param('id') id: string, @Body() dto: UpdateRetentionPolicyDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a retention policy',
    description:
      'Removes a retention policy. The entity will no longer be purged automatically.',
  })
  @ApiParam({ name: 'id', description: 'Retention policy ID' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('purge')
  @ApiOperation({
    summary: 'Trigger a purge run',
    description:
      'Manually trigger a retention purge for all enabled policies. ' +
      'Each purge produces an audit event recording the number of records affected.',
  })
  async executePurge() {
    const results = await this.service.executePurge();
    return {
      message: 'Purge execution completed',
      results,
      totalAffected: results.reduce((sum, r) => sum + r.affected, 0),
    };
  }

  @Post('seed')
  @ApiOperation({
    summary: 'Seed default retention policies',
    description:
      'Creates default retention policies for all supported entities if they do not already exist.',
  })
  async seedDefaults() {
    await this.service.seedDefaults();
    return { message: 'Default retention policies seeded' };
  }
}
