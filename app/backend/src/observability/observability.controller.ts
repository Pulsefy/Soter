import { Controller, Body, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { ObservabilityService } from './observability.service';
import { CreateObservabilityDto } from './dto/create-observability.dto';
import { UpdateObservabilityDto } from './dto/update-observability.dto';

@ApiTags('Observability')
@Controller('observability')
export class ObservabilityController {
  constructor(private readonly observabilityService: ObservabilityService) {}

  @ApiOperation({ summary: 'Create observability record' })
  @ApiCreatedResponse({ description: 'Record created successfully.' })
  create(@Body() createObservabilityDto: CreateObservabilityDto) {
    return this.observabilityService.create(createObservabilityDto);
  }

  @ApiOperation({ summary: 'List all observability records' })
  @ApiOkResponse({ description: 'Records retrieved successfully.' })
  findAll() {
    return this.observabilityService.findAll();
  }

  @ApiOperation({ summary: 'Get observability record by ID' })
  @ApiOkResponse({ description: 'Record retrieved successfully.' })
  @ApiNotFoundResponse({ description: 'Record not found.' })
  findOne(@Param('id') id: string) {
    return this.observabilityService.findOne(+id);
  }

  @ApiOperation({ summary: 'Update observability record' })
  @ApiOkResponse({ description: 'Record updated successfully.' })
  @ApiNotFoundResponse({ description: 'Record not found.' })
  update(
    @Param('id') id: string,
    @Body() updateObservabilityDto: UpdateObservabilityDto,
  ) {
    return this.observabilityService.update(+id, updateObservabilityDto);
  }

  @ApiOperation({ summary: 'Delete observability record' })
  @ApiOkResponse({ description: 'Record deleted successfully.' })
  @ApiNotFoundResponse({ description: 'Record not found.' })
  remove(@Param('id') id: string) {
    return this.observabilityService.remove(+id);
  }
}
