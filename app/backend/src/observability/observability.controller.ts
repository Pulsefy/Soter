import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ObservabilityService } from './observability.service';
import { CreateObservabilityDto } from './dto/create-observability.dto';
import { UpdateObservabilityDto } from './dto/update-observability.dto';

@Controller('observability')
export class ObservabilityController {
  constructor(private readonly observabilityService: ObservabilityService) {}

  @Post()
  create(@Body() createObservabilityDto: CreateObservabilityDto) {
    return this.observabilityService.create(createObservabilityDto);
  }

  @Get()
  findAll() {
    return this.observabilityService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.observabilityService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateObservabilityDto: UpdateObservabilityDto,
  ) {
    return this.observabilityService.update(+id, updateObservabilityDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.observabilityService.remove(+id);
  }
}
