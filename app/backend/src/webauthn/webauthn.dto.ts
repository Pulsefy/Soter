/**
 * DTOs for WebAuthn registration and authentication ceremonies.
 *
 * The flow follows the W3C WebAuthn Level 2 spec:
 *   1. Client requests registration options  → server returns PublicKeyCredentialCreationOptions
 *   2. Client creates credential via navigator.credentials.create() → sends attestation response
 *   3. Server verifies attestation → stores credential
 *   4. Client requests authentication options → server returns PublicKeyCredentialRequestOptions
 *   5. Client gets assertion via navigator.credentials.get() → sends assertion response
 *   6. Server verifies assertion → returns success + user context
 */

import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export class RegistrationOptionsRequestDto {
  @ApiProperty({
    description: 'Human-readable label for the authenticator (e.g. "MacBook Touch ID")',
    example: 'My Laptop',
  })
  @IsString()
  @IsOptional()
  label?: string;
}

export class RegistrationOptionsResponseDto {
  @ApiProperty({ description: 'Base64url-encoded challenge from the server' })
  challenge: string;

  @ApiProperty({ description: 'Relying party (server) identifier', example: 'localhost' })
  rpId: string;

  @ApiProperty({ description: 'Relying party display name', example: 'Soter' })
  rpName: string;

  @ApiProperty({ description: 'User ID (base64url-encoded)', })
  userId: string;

  @ApiProperty({ description: 'User display name (email)' })
  userName: string;

  @ApiProperty({ description: 'User display name for UI' })
  userDisplayName: string;

  @ApiProperty({
    description: 'Preferred authenticator attachment',
    enum: ['platform', 'cross-platform'],
  })
  authenticatorAttachment: 'platform' | 'cross-platform';

  @ApiProperty({ description: 'Timeout in milliseconds', example: 60000 })
  timeout: number;

  @ApiProperty({
    description: 'Attestation conveyance preference',
    enum: ['none', 'indirect', 'direct'],
  })
  attestation: 'none' | 'indirect' | 'direct';

  @ApiProperty({ description: 'Unique challenge ID for tracking' })
  challengeId: string;
}

export class VerifyRegistrationRequestDto {
  @ApiProperty({ description: 'Challenge ID returned from registration options' })
  @IsString()
  @IsNotEmpty()
  challengeId: string;

  @ApiProperty({ description: 'Credential ID from the authenticator (base64url)' })
  @IsString()
  @IsNotEmpty()
  credentialId: string;

  @ApiProperty({ description: 'Attestation object (base64url)' })
  @IsString()
  @IsNotEmpty()
  attestationObject: string;

  @ApiProperty({ description: 'Client data JSON (base64url)' })
  @IsString()
  @IsNotEmpty()
  clientDataJSON: string;

  @ApiPropertyOptional({ description: 'Authenticator attachment used' })
  @IsString()
  @IsOptional()
  authenticatorAttachment?: string;

  @ApiPropertyOptional({ description: 'Human-readable label for this credential' })
  @IsString()
  @IsOptional()
  label?: string;
}

export class VerifyRegistrationResponseDto {
  @ApiProperty({ description: 'Whether registration was successful' })
  success: boolean;

  @ApiProperty({ description: 'Credential ID that was registered' })
  credentialId: string;

  @ApiProperty({ description: 'Human-readable result message' })
  message: string;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export class AuthenticationOptionsRequestDto {
  @ApiPropertyOptional({
    description: 'User email — when provided, only that user\'s credentials are listed',
  })
  @IsString()
  @IsOptional()
  email?: string;
}

export class AuthenticationOptionsResponseDto {
  @ApiProperty({ description: 'Base64url-encoded challenge' })
  challenge: string;

  @ApiProperty({ description: 'Relying party ID', example: 'localhost' })
  rpId: string;

  @ApiProperty({ description: 'Timeout in milliseconds', example: 60000 })
  timeout: number;

  @ApiProperty({
    description: 'Allowed credential descriptors (list of registered credential IDs)',
    type: [Object],
  })
  allowCredentials: Array<{
    id: string;
    type: 'public-key';
    transports: string[];
  }>;

  @ApiProperty({ description: 'User verification requirement', example: 'preferred' })
  userVerification: 'required' | 'preferred' | 'discouraged';

  @ApiProperty({ description: 'Unique challenge ID for tracking' })
  challengeId: string;
}

export class VerifyAuthenticationRequestDto {
  @ApiProperty({ description: 'Challenge ID returned from authentication options' })
  @IsString()
  @IsNotEmpty()
  challengeId: string;

  @ApiProperty({ description: 'Credential ID used for authentication (base64url)' })
  @IsString()
  @IsNotEmpty()
  credentialId: string;

  @ApiProperty({ description: 'Authenticator data (base64url)' })
  @IsString()
  @IsNotEmpty()
  authenticatorData: string;

  @ApiProperty({ description: 'Client data JSON (base64url)' })
  @IsString()
  @IsNotEmpty()
  clientDataJSON: string;

  @ApiProperty({ description: 'Signature from the authenticator (base64url)' })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiPropertyOptional({ description: 'User handle (base64url)' })
  @IsString()
  @IsOptional()
  userHandle?: string;
}

export class VerifyAuthenticationResponseDto {
  @ApiProperty({ description: 'Whether authentication was successful' })
  success: boolean;

  @ApiProperty({ description: 'Authenticated user ID' })
  userId: string;

  @ApiProperty({ description: 'Authenticated user email' })
  email: string;

  @ApiProperty({ description: 'User role' })
  role: string;

  @ApiProperty({ description: 'Human-readable result message' })
  message: string;
}
