/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable } from '@nestjs/common';
import { CreateObservabilityDto } from './dto/create-observability.dto';
import { UpdateObservabilityDto } from './dto/update-observability.dto';

@Injectable()
export class ObservabilityService {
  create(createObservabilityDto: CreateObservabilityDto) {
    return 'This action adds a new observability';
  }

  findAll() {
    return `This action returns all observability`;
  }

  findOne(id: number) {
    return `This action returns a #${id} observability`;
  }

  update(id: number, updateObservabilityDto: UpdateObservabilityDto) {
    return `This action updates a #${id} observability`;
  }

  remove(id: number) {
    return `This action removes a #${id} observability`;
  }
}
