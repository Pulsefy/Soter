/**
 * WebAuthn service — handles registration and authentication ceremonies.
 *
 * Uses @simplewebauthn/server for standards-compliant cryptographic verification
 * and Prisma for credential / challenge persistence.
 *
 * Flow:
 *   Registration: generateRegistrationOptions → verifyRegistration
 *   Authentication: generateAuthenticationOptions → verifyAuthentication
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

import type {
  RegistrationOptionsResponseDto,
  AuthenticationOptionsResponseDto,
  VerifyRegistrationRequestDto,
  VerifyAuthenticationRequestDto,
} from './webauthn.dto';

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);
  private readonly rpId: string;
  private readonly rpName: string;
  private readonly origin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.rpId = this.config.get<string>('WEBAUTHN_RP_ID') ?? 'localhost';
    this.rpName = this.config.get<string>('WEBAUTHN_RP_NAME') ?? 'Soter';
    this.origin =
      this.config.get<string>('WEBAUTHN_ORIGIN') ?? 'http://localhost:3000';
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Generate PublicKeyCredentialCreationOptions for a new passkey registration.
   *
   * 1. Look up (or require) a user by email
   * 2. Load existing credentials to exclude them
   * 3. Generate options via @simplewebauthn/server
   * 4. Persist the challenge in WebAuthnChallenge
   */
  async generateRegistrationOptions(
    email: string,
    label?: string,
  ): Promise<RegistrationOptionsResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException(
        `User with email "${email}" not found. Register an account first.`,
      );
    }

    // Load existing credentials so the authenticator can exclude them
    const existingCredentials = await this.prisma.webAuthnCredential.findMany({
      where: { userId: user.id, deletedAt: null },
      select: { credentialId: true },
    });

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.email,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      excludeCredentials: existingCredentials.map((c) => ({
        id: c.credentialId,
        type: 'public-key' as const,
        transports: ['internal' as const],
      })),
    });

    // Persist the challenge
    const challengeRecord = await this.prisma.webAuthnChallenge.create({
      data: {
        userId: user.id,
        challenge: options.challenge,
        type: 'registration',
        expiresAt: new Date(Date.now() + 60_000), // 60 seconds
      },
    });

    return {
      challenge: options.challenge,
      rpId: this.rpId,
      rpName: this.rpName,
      userId: options.user.id,
      userName: options.user.name,
      userDisplayName: options.user.displayName,
      authenticatorAttachment: 'platform',
      timeout: options.timeout ?? 60_000,
      attestation: options.attestation ?? 'none',
      challengeId: challengeRecord.id,
    };
  }

  /**
   * Verify the attestation response from the client and persist the credential.
   */
  async verifyRegistration(
    dto: VerifyRegistrationRequestDto,
  ): Promise<{ success: boolean; credentialId: string; message: string }> {
    // 1. Look up the challenge
    const challengeRecord = await this.prisma.webAuthnChallenge.findUnique({
      where: { id: dto.challengeId },
    });

    if (!challengeRecord) {
      throw new BadRequestException('Challenge not found');
    }

    if (challengeRecord.consumedAt) {
      throw new BadRequestException('Challenge already consumed');
    }

    if (challengeRecord.expiresAt < new Date()) {
      throw new BadRequestException('Challenge expired');
    }

    if (challengeRecord.type !== 'registration') {
      throw new BadRequestException('Challenge type mismatch');
    }

    // 2. Build the registration response JSON expected by @simplewebauthn
    const registrationResponse: RegistrationResponseJSON = {
      id: dto.credentialId,
      rawId: dto.credentialId,
      response: {
        attestationObject: dto.attestationObject,
        clientDataJSON: dto.clientDataJSON,
      },
      type: 'public-key',
      authenticatorAttachment:
        (dto.authenticatorAttachment as 'platform' | 'cross-platform') ??
        'platform',
      clientExtensionResults: {},
    };

    // 3. Verify the attestation
    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response: registrationResponse,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpId,
      });
    } catch (err) {
      this.logger.warn(`Registration verification failed: ${(err as Error).message}`);
      throw new BadRequestException('Attestation verification failed');
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Attestation verification failed');
    }

    const { credential } = verification.registrationInfo;

    // 4. Check for duplicate credential ID
    const existing = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: dto.credentialId },
    });
    if (existing) {
      throw new ConflictException('Credential already registered');
    }

    // 5. Persist the credential
    await this.prisma.webAuthnCredential.create({
      data: {
        userId: challengeRecord.userId!,
        credentialId: dto.credentialId,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        attachment: dto.authenticatorAttachment ?? 'platform',
        label: dto.label ?? null,
        verified: true,
      },
    });

    // 6. Consume the challenge
    await this.prisma.webAuthnChallenge.update({
      where: { id: dto.challengeId },
      data: { consumedAt: new Date() },
    });

    this.logger.log(
      `WebAuthn credential registered for user ${challengeRecord.userId}`,
    );

    return {
      success: true,
      credentialId: dto.credentialId,
      message: 'Passkey registered successfully',
    };
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  /**
   * Generate PublicKeyCredentialRequestOptions for an authentication ceremony.
   */
  async generateAuthenticationOptions(
    email?: string,
  ): Promise<AuthenticationOptionsResponseDto> {
    let allowCredentials: Array<{
      id: string;
      type: 'public-key';
      transports: string[];
    }> = [];
    let userId: string | undefined;

    if (email) {
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) {
        throw new NotFoundException(`User with email "${email}" not found`);
      }
      userId = user.id;

      const credentials = await this.prisma.webAuthnCredential.findMany({
        where: { userId: user.id, deletedAt: null },
        select: { credentialId: true },
      });
      allowCredentials = credentials.map((c) => ({
        id: c.credentialId,
        type: 'public-key' as const,
        transports: ['internal'],
      }));
    } else {
      // If no email, return all credentials (user will be identified by which one they use)
      // This is less secure but enables "usernameless" flows
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: 'preferred',
      allowCredentials,
    });

    // Persist the challenge
    const challengeRecord = await this.prisma.webAuthnChallenge.create({
      data: {
        userId,
        challenge: options.challenge,
        type: 'authentication',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    return {
      challenge: options.challenge,
      rpId: this.rpId,
      timeout: options.timeout ?? 60_000,
      allowCredentials,
      userVerification: options.userVerification ?? 'preferred',
      challengeId: challengeRecord.id,
    };
  }

  /**
   * Verify the authentication assertion and return user context.
   */
  async verifyAuthentication(
    dto: VerifyAuthenticationRequestDto,
  ): Promise<{
    success: boolean;
    userId: string;
    email: string;
    role: string;
    message: string;
  }> {
    // 1. Look up the challenge
    const challengeRecord = await this.prisma.webAuthnChallenge.findUnique({
      where: { id: dto.challengeId },
    });

    if (!challengeRecord) {
      throw new BadRequestException('Challenge not found');
    }

    if (challengeRecord.consumedAt) {
      throw new BadRequestException('Challenge already consumed');
    }

    if (challengeRecord.expiresAt < new Date()) {
      throw new BadRequestException('Challenge expired');
    }

    if (challengeRecord.type !== 'authentication') {
      throw new BadRequestException('Challenge type mismatch');
    }

    // 2. Look up the credential
    const credential = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: dto.credentialId, deletedAt: null },
      include: { user: true },
    });

    if (!credential) {
      throw new UnauthorizedException('Credential not recognized');
    }

    // 3. Build the authentication response JSON
    const authenticationResponse: AuthenticationResponseJSON = {
      id: dto.credentialId,
      rawId: dto.credentialId,
      response: {
        authenticatorData: dto.authenticatorData,
        clientDataJSON: dto.clientDataJSON,
        signature: dto.signature,
        userHandle: dto.userHandle,
      },
      type: 'public-key',
      clientExtensionResults: {},
    };

    // 4. Verify the assertion
    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response: authenticationResponse,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpId,
        credential: {
          id: credential.credentialId,
          publicKey: Buffer.from(credential.publicKey, 'base64url'),
          counter: credential.counter,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Authentication verification failed: ${(err as Error).message}`,
      );
      throw new UnauthorizedException('Assertion verification failed');
    }

    if (!verification.verified) {
      throw new UnauthorizedException('Assertion verification failed');
    }

    // 5. Update the credential counter and last-used timestamp
    await this.prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    // 6. Consume the challenge
    await this.prisma.webAuthnChallenge.update({
      where: { id: dto.challengeId },
      data: { consumedAt: new Date() },
    });

    this.logger.log(
      `WebAuthn authentication successful for user ${credential.userId}`,
    );

    return {
      success: true,
      userId: credential.userId,
      email: credential.user.email,
      role: credential.user.role,
      message: 'Authentication successful',
    };
  }

  // -------------------------------------------------------------------------
  // Utility: list / delete credentials
  // -------------------------------------------------------------------------

  /** List all registered credentials for a user (by email). */
  async listCredentials(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException(`User with email "${email}" not found`);
    }

    const credentials = await this.prisma.webAuthnCredential.findMany({
      where: { userId: user.id, deletedAt: null },
      select: {
        id: true,
        credentialId: true,
        attachment: true,
        label: true,
        verified: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return credentials;
  }

  /** Soft-delete a credential. */
  async deleteCredential(credentialId: string, userId: string) {
    const credential = await this.prisma.webAuthnCredential.findFirst({
      where: { credentialId, userId, deletedAt: null },
    });
    if (!credential) {
      throw new NotFoundException('Credential not found');
    }

    await this.prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: { deletedAt: new Date() },
    });

    return { success: true, message: 'Credential removed' };
  }

  /** Periodic cleanup of expired challenges (called by a cron job). */
  async cleanupExpiredChallenges() {
    const result = await this.prisma.webAuthnChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    this.logger.log(`Cleaned up ${result.count} expired WebAuthn challenges`);
    return result.count;
  }
}
