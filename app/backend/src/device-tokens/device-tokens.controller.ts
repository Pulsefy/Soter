import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { DeviceTokensService } from './device-tokens.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { RevokeDeviceTokenDto } from './dto/revoke-device-token.dto';

@ApiTags('Device Tokens')
@ApiBearerAuth('JWT-auth')
@Controller('device-tokens')
export class DeviceTokensController {
  constructor(private readonly deviceTokens: DeviceTokensService) {}

  @Post()
  @ApiOperation({
    summary: 'Register or update a device notification token',
    description:
      'Registers a new device push notification token or updates an existing one. Idempotent: if the same (userId, deviceId, platform) exists, the token is updated.',
  })
  @ApiCreatedResponse({ description: 'Device token registered or updated.' })
  @ApiBadRequestResponse({ description: 'Invalid payload.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid credentials.' })
  async register(@Body() dto: RegisterDeviceTokenDto, @Req() req: Request) {
    const actor = {
      userId: req.user?.id,
      orgId: req.user?.orgId as string | undefined,
      role: req.user?.role as string | undefined,
    };
    const token = await this.deviceTokens.register(dto, actor);
    return ApiResponseDto.ok(token, 'Device token registered');
  }

  @Get()
  @ApiOperation({
    summary: 'List device tokens for the authenticated user',
    description:
      'Returns all device notification tokens for the authenticated user.',
  })
  @ApiOkResponse({ description: 'Device tokens listed.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid credentials.' })
  async list(@Req() req: Request) {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseDto.badRequest('User ID not found in request');
    }
    const tokens = await this.deviceTokens.list(userId);
    return ApiResponseDto.ok(tokens, 'Device tokens fetched');
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a specific device token',
    description: 'Returns details of a specific device token by ID.',
  })
  @ApiOkResponse({ description: 'Device token fetched.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid credentials.' })
  async get(@Param('id') id: string, @Req() req: Request) {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseDto.badRequest('User ID not found in request');
    }
    const token = await this.deviceTokens.get(id, userId);
    return ApiResponseDto.ok(token, 'Device token fetched');
  }

  @Post(':id/revoke')
  @ApiOperation({
    summary: 'Revoke a device token',
    description: 'Revokes a device notification token (soft delete).',
  })
  @ApiOkResponse({ description: 'Device token revoked.' })
  @ApiBadRequestResponse({
    description: 'Cannot revoke already revoked token.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid credentials.' })
  async revoke(
    @Param('id') id: string,
    @Body() dto: RevokeDeviceTokenDto,
    @Req() req: Request,
  ) {
    const actor = {
      userId: req.user?.id,
      orgId: req.user?.orgId as string | undefined,
      role: req.user?.role as string | undefined,
    };
    const token = await this.deviceTokens.revoke(id, dto.reason, actor);
    return ApiResponseDto.ok(token, 'Device token revoked');
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a device token',
    description: 'Permanently deletes a device notification token.',
  })
  @ApiOkResponse({ description: 'Device token deleted.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid credentials.' })
  async delete(@Param('id') id: string, @Req() req: Request) {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseDto.badRequest('User ID not found in request');
    }
    const result = await this.deviceTokens.delete(id, userId);
    return ApiResponseDto.ok(result, 'Device token deleted');
  }

  @Put(':id/heartbeat')
  @ApiOperation({
    summary: 'Update last used timestamp',
    description:
      'Updates the lastUsedAt timestamp for a device token (heartbeat).',
  })
  @ApiOkResponse({ description: 'Last used timestamp updated.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid credentials.' })
  async heartbeat(@Param('id') id: string, @Req() req: Request) {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseDto.badRequest('User ID not found in request');
    }
    const result = await this.deviceTokens.updateLastUsed(id, userId);
    return ApiResponseDto.ok(result, 'Last used timestamp updated');
  }
}
