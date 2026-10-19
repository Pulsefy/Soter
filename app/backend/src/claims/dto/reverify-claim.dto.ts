import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum ReverifyActorRole {
  operator = 'operator',
  admin = 'admin',
}

export class ReverifyClaimDto {
  @ApiProperty({
    description: 'Reason for re-running verification (recorded in the audit log).',
    example: 'Prompt fix deployed; re-running verification.',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({
    description:
      'Identifier of the actor requesting re-verification (recorded in the audit log).',
    example: 'operator@example.com',
  })
  @IsString()
  @IsNotEmpty()
  actor: string;

  @ApiProperty({
    description:
      'Override the terminal-state guard. Required to re-verify a disbursed claim. The override is recorded in the audit log.',
    required: false,
    default: false,
  })
  @IsOptional()
  overrideTerminal?: boolean;
}
