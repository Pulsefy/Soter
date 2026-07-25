/**
 * WebAuthn controller — exposes registration and authentication ceremony endpoints.
 *
 * All endpoints are marked @Public() because WebAuthn IS the authentication
 * mechanism — callers do not yet have an API key when they start the ceremony.
 *
 * Endpoints:
 *   POST /api/v1/webauthn/register/options   → get registration challenge
 *   POST /api/v1/webauthn/register/verify     → verify attestation & store credential
 *   POST /api/v1/webauthn/auth/options        → get authentication challenge
 *   POST /api/v1/webauthn/auth/verify         → verify assertion & return user context
 *   GET  /api/v1/webauthn/credentials         → list registered passkeys for a user
 *   DELETE /api/v1/webauthn/credentials/:id   → soft-delete a credential
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { API_VERSIONS } from '../common/constants/api-version.constants';
import { WebAuthnService } from './webauthn.service';
import {
  RegistrationOptionsRequestDto,
  RegistrationOptionsResponseDto,
  VerifyRegistrationRequestDto,
  VerifyRegistrationResponseDto,
  AuthenticationOptionsRequestDto,
  AuthenticationOptionsResponseDto,
  VerifyAuthenticationRequestDto,
  VerifyAuthenticationResponseDto,
} from './webauthn.dto';

@ApiTags('WebAuthn')
@Controller('webauthn')
export class WebAuthnController {
  constructor(private readonly webauthnService: WebAuthnService) {}

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  @Public()
  @Post('register/options')
  @Version(API_VERSIONS.V1)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate WebAuthn registration options',
    description:
      'Returns PublicKeyCredentialCreationOptions for the browser to call navigator.credentials.create().',
  })
  @ApiOkResponse({ type: RegistrationOptionsResponseDto })
  async registrationOptions(
    @Query('email') email: string,
    @Body() dto: RegistrationOptionsRequestDto,
  ): Promise<RegistrationOptionsResponseDto> {
    return this.webauthnService.generateRegistrationOptions(email, dto.label);
  }

  @Public()
  @Post('register/verify')
  @Version(API_VERSIONS.V1)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify WebAuthn registration response',
    description:
      'Verifies the attestation from navigator.credentials.create() and stores the credential.',
  })
  @ApiOkResponse({ type: VerifyRegistrationResponseDto })
  @ApiBody({ type: VerifyRegistrationRequestDto })
  async verifyRegistration(
    @Body() dto: VerifyRegistrationRequestDto,
  ): Promise<VerifyRegistrationResponseDto> {
    return this.webauthnService.verifyRegistration(dto);
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  @Public()
  @Post('auth/options')
  @Version(API_VERSIONS.V1)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate WebAuthn authentication options',
    description:
      'Returns PublicKeyCredentialRequestOptions for the browser to call navigator.credentials.get().',
  })
  @ApiOkResponse({ type: AuthenticationOptionsResponseDto })
  async authenticationOptions(
    @Body() dto: AuthenticationOptionsRequestDto,
  ): Promise<AuthenticationOptionsResponseDto> {
    return this.webauthnService.generateAuthenticationOptions(dto.email);
  }

  @Public()
  @Post('auth/verify')
  @Version(API_VERSIONS.V1)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify WebAuthn authentication response',
    description:
      'Verifies the assertion from navigator.credentials.get() and returns user context.',
  })
  @ApiOkResponse({ type: VerifyAuthenticationResponseDto })
  @ApiBody({ type: VerifyAuthenticationRequestDto })
  async verifyAuthentication(
    @Body() dto: VerifyAuthenticationRequestDto,
  ): Promise<VerifyAuthenticationResponseDto> {
    return this.webauthnService.verifyAuthentication(dto);
  }

  // -------------------------------------------------------------------------
  // Credential management
  // -------------------------------------------------------------------------

  @Public()
  @Get('credentials')
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'List WebAuthn credentials',
    description: 'Returns all registered passkeys for a user.',
  })
  @ApiQuery({ name: 'email', required: true, description: 'User email' })
  async listCredentials(@Query('email') email: string) {
    return this.webauthnService.listCredentials(email);
  }

  @Delete('credentials/:credentialId')
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'Delete a WebAuthn credential',
    description: 'Soft-deletes a registered passkey.',
  })
  @ApiQuery({ name: 'userId', required: true })
  async deleteCredential(
    @Param('credentialId') credentialId: string,
    @Query('userId') userId: string,
  ) {
    return this.webauthnService.deleteCredential(credentialId, userId);
  }
}
