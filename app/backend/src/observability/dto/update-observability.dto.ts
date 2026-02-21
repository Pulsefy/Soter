import { PartialType } from '@nestjs/swagger';
import { CreateObservabilityDto } from './create-observability.dto';

export class UpdateObservabilityDto extends PartialType(
  CreateObservabilityDto,
) {}
