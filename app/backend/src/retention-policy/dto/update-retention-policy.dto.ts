import { PartialType } from '@nestjs/swagger';
import { CreateRetentionPolicyDto } from './create-retention-policy.dto';

export class UpdateRetentionPolicyDto extends PartialType(
  CreateRetentionPolicyDto,
) {}
