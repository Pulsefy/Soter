import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsEnum,
  ValidateIf,
} from 'class-validator';

export enum VerificationChannelDto {
  email = 'email',
  phone = 'phone',
}

/** Used by ValidateIf so the callback parameter is typed (avoids @typescript-eslint/no-unsafe-member-access). */
interface StartVerificationDtoShape {
  channel?: VerificationChannelDto;
}

export class StartVerificationDto {
  @ApiProperty({
    description: 'Verification channel: email or phone',
    enum: VerificationChannelDto,
    example: 'email',
  })
  @IsEnum(VerificationChannelDto)
  channel!: VerificationChannelDto;

  @ApiPropertyOptional({
    description: 'Email address (required when channel is email)',
    example: 'user@example.com',
  })
  @ValidateIf(
    (o: StartVerificationDtoShape) =>
      o.channel === VerificationChannelDto.email,
  )
  @IsNotEmpty({ message: 'email is required when channel is email' })
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Phone number (required when channel is phone)',
    example: '+15551234567',
  })
  @ValidateIf(
    (o: StartVerificationDtoShape) =>
      o.channel === VerificationChannelDto.phone,
  )
  @IsNotEmpty({ message: 'phone is required when channel is phone' })
  @IsString()
  phone?: string;
}
