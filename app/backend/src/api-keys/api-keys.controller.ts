import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { RevokeApiKeyDto } from './dto/revoke-api-key.dto';

@ApiTags('API Keys')
@ApiBearerAuth('JWT-auth')
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Create an API key (returned once)',
    description:
      'Creates a new API key. The raw key is only returned at creation time; future listings show masked previews only.',
  })
  @ApiCreatedResponse({ description: 'API key created.' })
  @ApiBadRequestResponse({ description: 'Invalid payload.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions.' })
  async create(@Body() dto: CreateApiKeyDto, @Req() req: Request) {
    const created = await this.apiKeys.create(dto, req.user);
    return ApiResponseDto.ok(created, 'API key created');
  }

  @Get()
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'List API keys (masked previews only)',
  })
  @ApiOkResponse({ description: 'API keys listed.' })
  async list() {
    const keys = await this.apiKeys.list();
    return ApiResponseDto.ok(keys, 'API keys fetched');
  }

  @Post(':id/rotate')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Rotate an API key (revoke old, create new)',
  })
  @ApiOkResponse({ description: 'API key rotated.' })
  @ApiBadRequestResponse({ description: 'Cannot rotate revoked key.' })
  async rotate(@Param('id') id: string, @Req() req: Request) {
    const rotated = await this.apiKeys.rotate(id, req.user);
    return ApiResponseDto.ok(rotated, 'API key rotated');
  }

  @Post(':id/revoke')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Revoke an API key',
  })
  @ApiOkResponse({ description: 'API key revoked.' })
  async revoke(
    @Param('id') id: string,
    @Body() dto: RevokeApiKeyDto,
    @Req() req: Request,
  ) {
    const revoked = await this.apiKeys.revoke(id, dto.reason, req.user);
    return ApiResponseDto.ok(revoked, 'API key revoked');
  }
}
